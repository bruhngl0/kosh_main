import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { conflict, notFound } from "@/server/errors";
import { normaliseIngredientName } from "@/shared/schemas/common";
import { toNullableNumber, toNumber } from "@/shared/money";
import { parStatus, reorderQuantity } from "@/modules/inventory/domain/movements";
import type { IngredientContext } from "@/modules/procurement/domain/demand";
import type { CreateIngredientInput, UpdateIngredientInput } from "@/shared/schemas/inventory";
import * as repository from "@/modules/inventory/infrastructure/ingredient-repository";

type Context = { actor: Actor; requestId: string };

export async function createIngredient(input: CreateIngredientInput, context: Context) {
  assertCan(context.actor, "inventory:write");

  const normalizedName = normaliseIngredientName(input.name);
  const existing = await repository.findIngredientByNormalisedName(db, normalizedName);
  if (existing) {
    throw conflict(`"${existing.name}" is already on the ingredient list.`, { ingredientId: existing.id });
  }

  return db.$transaction(async (tx) => {
    const ingredient = await repository.createIngredient(tx, {
      name: input.name,
      normalizedName,
      category: input.category,
      defaultUnit: input.defaultUnit,
      defaultFrequency: input.defaultFrequency,
      quantityNeeded: input.quantityNeeded,
      inventoryStatus: input.status,
      notes: input.notes,
      inventoryManaged: true,
      balance: {
        create: {
          quantity: input.quantity,
          parLevel: input.parLevel,
          reorderPoint: input.reorderPoint ?? input.parLevel,
        },
      },
    });

    if (input.vendorId) {
      await repository.upsertVendorIngredient(tx, {
        vendorId: input.vendorId,
        ingredientId: ingredient.id,
        unitCost: input.unitCost,
        unit: input.purchaseUnit ?? input.defaultUnit,
        preferred: true,
      });
    }

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "ingredient.created",
      entityType: "Ingredient",
      entityId: ingredient.id,
      after: ingredient,
      requestId: context.requestId,
    });

    return toIngredientView(await repository.findIngredientById(tx, ingredient.id));
  });
}

export async function updateIngredient(id: string, input: UpdateIngredientInput, context: Context) {
  assertCan(context.actor, "inventory:write");

  const before = await repository.findIngredientById(db, id);
  if (!before) throw notFound("Ingredient", id);

  return db.$transaction(async (tx) => {
    const updated = await repository.updateIngredient(tx, id, {
      name: input.name,
      // Renaming must move the unique key with it, or the next create collides.
      ...(input.name ? { normalizedName: normaliseIngredientName(input.name) } : {}),
      category: input.category,
      defaultUnit: input.defaultUnit,
      defaultFrequency: input.defaultFrequency,
      notes: input.notes,
      quantityNeeded: input.quantityNeeded,
      inventoryStatus: input.status,
    });

    // Par level and reorder point live on the balance, not the ingredient.
    // Stock quantity is deliberately absent: it changes only via a movement (BR-11).
    if (input.parLevel !== undefined || input.reorderPoint !== undefined) {
      await repository.upsertBalance(tx, {
        ingredientId: id,
        parLevel: input.parLevel,
        reorderPoint: input.reorderPoint,
      });
    }

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "ingredient.updated",
      entityType: "Ingredient",
      entityId: id,
      before,
      after: updated,
      requestId: context.requestId,
    });

    return toIngredientView(await repository.findIngredientById(tx, id));
  });
}

export async function archiveIngredient(id: string, context: Context) {
  assertCan(context.actor, "inventory:write");

  const before = await repository.findIngredientById(db, id);
  if (!before) throw notFound("Ingredient", id);

  return db.$transaction(async (tx) => {
    await repository.archiveIngredient(tx, id);
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "ingredient.archived",
      entityType: "Ingredient",
      entityId: id,
      before: { active: before.active },
      after: { active: false },
      requestId: context.requestId,
    });
    return { id, archived: true };
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listIngredients(filter: repository.IngredientFilter & { belowParOnly?: boolean } = {}) {
  const rows = await repository.listIngredients(db, filter);
  const views = rows.map(toIngredientView);
  return filter.belowParOnly ? views.filter((item) => item.parStatus !== "ok") : views;
}

export async function getIngredient(id: string) {
  const ingredient = await repository.findIngredientById(db, id);
  if (!ingredient) throw notFound("Ingredient", id);
  return toIngredientView(ingredient);
}

/** KPI header and reorder worklist for the inventory screen. */
export async function getInventorySummary() {
  const rows = await repository.listIngredients(db, { managedOnly: true });
  const views = rows.map(toIngredientView);

  const belowPar = views.filter((item) => item.parStatus !== "ok");
  const projectedSpend = belowPar.reduce(
    (sum, item) => sum + item.reorderQuantity * (item.unitCost ?? 0),
    0,
  );

  return {
    totalItems: views.length,
    outOfStock: views.filter((item) => item.parStatus === "out-of-stock").length,
    belowPar: belowPar.length,
    needed: views.filter((item) => item.inventoryStatus === "needed").length,
    ordered: views.filter((item) => item.inventoryStatus === "ordered").length,
    received: views.filter((item) => item.inventoryStatus === "received").length,
    projectedSpend: Math.round(projectedSpend * 100) / 100,
    belowParItems: belowPar,
  };
}

/**
 * Published cross-module query (§4.3). Procurement and production call this to
 * get the stock and vendor context demand aggregation needs, rather than
 * querying ingredient tables themselves.
 */
export async function getIngredientContexts(ingredientIds: string[]) {
  if (!ingredientIds.length) return new Map<string, IngredientContext>();

  const rows = await repository.findIngredientsByIds(db, ingredientIds);
  return new Map(
    rows.map((ingredient) => {
      const link = ingredient.vendorIngredients[0];
      return [
        ingredient.id,
        {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          stockUnit: ingredient.defaultUnit,
          stockOnHand: toNumber(ingredient.balance?.quantity),
          preferredVendorId: link?.vendorId ?? null,
          preferredVendorName: link?.vendor.name ?? null,
          purchaseUnit: link?.unit ?? null,
          unitCost: link?.unitCost ? toNumber(link.unitCost) : null,
        } satisfies IngredientContext,
      ];
    }),
  );
}

export type IngredientView = ReturnType<typeof toIngredientView>;

function toIngredientView(ingredient: repository.IngredientWithContext | null) {
  if (!ingredient) throw notFound("Ingredient");

  const quantity = toNumber(ingredient.balance?.quantity);
  const parLevel = toNumber(ingredient.balance?.parLevel);
  const link = ingredient.vendorIngredients[0];

  return {
    id: ingredient.id,
    name: ingredient.name,
    category: ingredient.category,
    defaultUnit: ingredient.defaultUnit,
    defaultFrequency: ingredient.defaultFrequency,
    inventoryStatus: ingredient.inventoryStatus,
    inventoryManaged: ingredient.inventoryManaged,
    quantityNeeded: toNumber(ingredient.quantityNeeded),
    notes: ingredient.notes,
    active: ingredient.active,
    quantity,
    parLevel,
    reorderPoint: toNumber(ingredient.balance?.reorderPoint),
    parStatus: parStatus(quantity, parLevel),
    reorderQuantity: reorderQuantity(quantity, parLevel),
    unitCost: link?.unitCost ? toNumber(link.unitCost) : null,
    purchaseUnit: link?.unit ?? null,
    minimumQty: toNullableNumber(link?.minimumQty),
    vendor: link?.vendor ? { id: link.vendor.id, name: link.vendor.name } : null,
    // Standing reference value × price, which is what the prototype's
    // "Total cost" column showed (BR-7 note).
    standingLineCost: link?.unitCost ? toNumber(ingredient.quantityNeeded) * toNumber(link.unitCost) : null,
  };
}
