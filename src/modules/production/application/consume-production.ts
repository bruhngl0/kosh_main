import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound, unprocessable } from "@/server/errors";
import { getDayDemandInputs, type MealType } from "@/modules/cycles";
import { applyMovements, getIngredientContexts } from "@/modules/inventory";
import { aggregateDemand } from "@/modules/procurement/domain/demand";
import { toNumber } from "@/shared/money";
import type { ConsumeProductionInput } from "@/shared/schemas/cycle";

/**
 * BR-14 — record what a production run consumed.
 *
 * The final missing link in the loop: plan → buy → receive → **cook** → stock
 * goes down. Every ingredient is checked against BR-10, so a run that would
 * drive stock negative is refused unless an authorised actor overrides it, and
 * the override is recorded on each movement.
 */

type Context = { actor: Actor; requestId: string };

export async function consumeProduction(
  target: { cycleId: string; dayNumber: number },
  input: ConsumeProductionInput,
  context: Context,
) {
  assertCan(context.actor, "production:write");

  const day = await db.cycleDay.findUnique({
    where: { cycleId_dayNumber: { cycleId: target.cycleId, dayNumber: target.dayNumber } },
    select: { id: true, dayNumber: true, cycle: { select: { id: true, name: true, status: true } } },
  });
  if (!day) throw notFound(`Day ${target.dayNumber} of this cycle`);

  if (day.cycle.status === "DRAFT") {
    throw unprocessable("Publish the cycle before recording production against it.", {
      status: day.cycle.status,
    });
  }

  const demandLines = await getDayDemandInputs(day.id, input.meals as MealType[] | undefined);
  if (!demandLines.length) {
    throw unprocessable(`Day ${target.dayNumber} has no meal assignments to produce.`);
  }

  const contexts = await getIngredientContexts([...new Set(demandLines.map((line) => line.ingredientId))]);
  const { demand, exceptions } = aggregateDemand(demandLines, contexts);

  if (!demand.length) {
    throw unprocessable("No consumable ingredient quantities could be calculated for this day.", { exceptions });
  }

  const reference = input.reference ?? `Production ${day.cycle.name} day ${target.dayNumber}`;
  const nameById = new Map(demand.map((item) => [item.ingredientId, item.ingredientName]));

  return db.$transaction(async (tx) => {
    // One batched call rather than four round trips per ingredient. If any
    // single movement is refused the whole transaction rolls back, so a
    // production run is never half-recorded.
    const applied = await applyMovements(
      tx,
      demand.map((item) => ({
        ingredientId: item.ingredientId,
        type: "CONSUME" as const,
        quantity: item.quantity,
        unit: item.unit,
        reference,
        allowNegative: input.allowNegative,
      })),
      context.actor.id,
    );

    const movements = applied.map((movement) => ({
      ingredientId: movement.ingredientId,
      ingredientName: nameById.get(movement.ingredientId) ?? "Unknown ingredient",
      consumed: toNumber(movement.quantityDelta),
      balanceAfter: toNumber(movement.balanceAfter),
      unit: movement.unit,
      negativeOverride: movement.negativeOverride ?? false,
    }));

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "production.consumed",
      entityType: "CycleDay",
      entityId: day.id,
      after: {
        cycleId: target.cycleId,
        dayNumber: target.dayNumber,
        meals: input.meals ?? "all",
        ingredientCount: movements.length,
        allowNegative: input.allowNegative,
      },
      requestId: context.requestId,
    });

    return {
      cycleId: target.cycleId,
      dayNumber: target.dayNumber,
      consumed: movements,
      // Ingredients we could not convert are reported, never silently skipped.
      exceptions,
    };
  });
}
