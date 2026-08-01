import type { InventoryMovementType, Prisma as PrismaTypes } from "@prisma/client";
import { db, type DbClient } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { AppError, insufficientStock, notFound, unconvertibleUnit } from "@/server/errors";
import { convert } from "@/shared/units";
import { toNumber } from "@/shared/money";
import { planMovement, type MovementType } from "@/modules/inventory/domain/movements";
import type { InventoryMovementInput } from "@/shared/schemas/inventory";
import * as repository from "@/modules/inventory/infrastructure/ingredient-repository";

/**
 * BR-9, BR-10, BR-11 — the only path that changes an inventory balance.
 *
 * Movement and balance are written in one transaction, with the balance row
 * locked first so a concurrent movement cannot race past the stock check.
 */

type Context = { actor: Actor; requestId: string };

export type MovementRequest = {
  ingredientId: string;
  type: MovementType;
  quantity: number;
  /** Unit of `quantity`. Converted to the ingredient's stock unit. */
  unit?: string;
  unitCost?: number;
  reason?: string;
  reference?: string;
  allowNegative?: boolean;
};

export async function recordMovement(input: InventoryMovementInput, context: Context) {
  assertCan(context.actor, "inventory:write");

  return db.$transaction(async (tx) => {
    const movement = await applyMovement(tx, input, context.actor.id);

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "inventory.movement",
      entityType: "InventoryMovement",
      entityId: movement.id,
      after: movement,
      requestId: context.requestId,
    });

    return movement;
  });
}

/**
 * Applies one movement inside an existing transaction.
 *
 * Exported so purchase-order receiving (BR-13) and production consumption
 * (BR-14) reuse the exact same stock rules instead of reimplementing them.
 */
export async function applyMovement(tx: DbClient, input: MovementRequest, actorId: string | null) {
  const [movement] = await applyMovements(tx, [input], actorId);
  return movement;
}

/**
 * Applies several movements in a bounded number of round trips.
 *
 * Production consumption and purchase-order receipt both touch many
 * ingredients at once. Doing that one at a time cost four round trips each,
 * which at Neon latencies pushes a large transaction past Prisma's 5s timeout.
 * This costs the same handful of queries whether it is one ingredient or fifty.
 *
 * Ordering rules are unchanged: every movement is still validated against
 * BR-9/BR-10 individually, and the whole batch fails if any single one is
 * refused — a production run that cannot be fully recorded should not be
 * half-recorded.
 */
export async function applyMovements(
  tx: DbClient,
  inputs: MovementRequest[],
  actorId: string | null,
) {
  if (!inputs.length) return [];

  const ingredientIds = [...new Set(inputs.map((input) => input.ingredientId))];
  const ingredients = await repository.findIngredientsByIds(tx, ingredientIds);
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  const missing = ingredientIds.find((id) => !byId.has(id));
  if (missing) throw notFound("Ingredient", missing);

  // Lock every balance up front, in a deterministic order, so the read-then-write
  // below is atomic against concurrent movements (BR-10).
  const locked = await repository.lockBalancesForUpdate(tx, ingredientIds);

  // Running balances, so several movements against the same ingredient in one
  // batch each see the effect of the previous one.
  const balances = new Map(
    ingredientIds.map((id) => [
      id,
      locked.get(id) ? Number(locked.get(id)!.quantity) : toNumber(byId.get(id)!.balance?.quantity),
    ]),
  );

  // `id` is optional on the Prisma input type but always assigned below, so the
  // caller can rely on it without reading the rows back.
  const movements: (PrismaTypes.InventoryMovementUncheckedCreateInput & { id: string })[] = [];

  for (const input of inputs) {
    const ingredient = byId.get(input.ingredientId)!;

    // Quantities may arrive in any unit; balances live in the stock unit (§6.2).
    const sourceUnit = input.unit ?? ingredient.defaultUnit;
    const quantity = convert(input.quantity, sourceUnit, ingredient.defaultUnit);
    if (quantity === null) {
      throw unconvertibleUnit({
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        from: sourceUnit,
        to: ingredient.defaultUnit,
      });
    }

    const outcome = planMovement({
      type: input.type,
      quantity,
      currentBalance: balances.get(ingredient.id)!,
      reason: input.reason,
      allowNegative: input.allowNegative,
    });

    if (!outcome.ok) {
      throw rejectionToError(outcome.rejection, ingredient.name, ingredient.id, ingredient.defaultUnit);
    }

    balances.set(ingredient.id, outcome.plan.balanceAfter);

    movements.push({
      id: crypto.randomUUID(),
      ingredientId: ingredient.id,
      type: input.type as InventoryMovementType,
      quantityDelta: outcome.plan.quantityDelta,
      balanceAfter: outcome.plan.balanceAfter,
      unit: ingredient.defaultUnit,
      unitCost: input.unitCost,
      reason: input.reason,
      reference: input.reference,
      negativeOverride: outcome.plan.negativeOverride,
      actorId,
    });
  }

  await repository.upsertBalances(
    tx,
    [...balances.entries()].map(([ingredientId, quantity]) => ({ ingredientId, quantity })),
  );
  await repository.createMovements(tx, movements);

  // IDs are assigned above, so the rows can be returned without reading back.
  return movements;
}

function rejectionToError(
  rejection: Extract<ReturnType<typeof planMovement>, { ok: false }>["rejection"],
  ingredientName: string,
  ingredientId: string,
  unit: string,
): AppError {
  switch (rejection.kind) {
    case "INSUFFICIENT_STOCK":
      return insufficientStock({
        ingredientId,
        ingredientName,
        available: rejection.available,
        requested: rejection.requested,
        unit,
      });
    case "REASON_REQUIRED":
      return new AppError(
        "VALIDATION_ERROR",
        `A reason is required for ${rejection.type.toLowerCase()} movements.`,
        { fields: { reason: ["A reason is required."] } },
      );
    case "NEGATIVE_QUANTITY":
      return new AppError("VALIDATION_ERROR", "Quantity cannot be negative.", {
        fields: { quantity: ["Cannot be negative."] },
      });
  }
}

export async function listMovements(filter: { ingredientId?: string; type?: string; limit: number }) {
  const movements = await repository.listMovements(db, filter);
  return movements.map((movement) => ({
    id: movement.id,
    ingredientId: movement.ingredientId,
    ingredientName: movement.ingredient.name,
    type: movement.type,
    quantityDelta: toNumber(movement.quantityDelta),
    balanceAfter: toNumber(movement.balanceAfter),
    unit: movement.unit,
    unitCost: movement.unitCost ? toNumber(movement.unitCost) : null,
    reason: movement.reason,
    reference: movement.reference,
    negativeOverride: movement.negativeOverride,
    actor: movement.actor?.name ?? null,
    createdAt: movement.createdAt.toISOString(),
  }));
}
