import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";
import { getDayDemandInputs, MEAL_NAMES, MEAL_ORDER, type MealType } from "@/modules/cycles";
import { applyMovements, getIngredientContexts } from "@/modules/inventory";
import { aggregateDemand } from "@/modules/procurement/domain/demand";
import { toNumber } from "@/shared/money";
import type { ConsumeProductionInput } from "@/shared/schemas/cycle";

/**
 * BR-14 — record what a production run consumed. BR-31 — and only once.
 *
 * The final missing link in the loop: plan → buy → receive → **cook** → stock
 * goes down. Every ingredient is checked against BR-10, so a run that would
 * drive stock negative is refused unless an authorised actor overrides it, and
 * the override is recorded on each movement.
 *
 * Each (cycle day, meal) consumed writes a `production_runs` row in the same
 * transaction, unique on that pair. Recording again skips meals already
 * recorded; naming a recorded meal explicitly is a conflict; two people
 * pressing the button at once cannot both deduct.
 */

type Context = { actor: Actor; requestId: string };
type Target = { cycleId: string; dayNumber: number };

async function findDay(target: Target) {
  const day = await db.cycleDay.findUnique({
    where: { cycleId_dayNumber: { cycleId: target.cycleId, dayNumber: target.dayNumber } },
    select: {
      id: true,
      dayNumber: true,
      cycle: { select: { id: true, name: true, status: true } },
      assignments: { select: { mealType: true } },
      productionRuns: {
        select: {
          mealType: true,
          recordedAt: true,
          negativeOverride: true,
          recordedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!day) throw notFound(`Day ${target.dayNumber} of this cycle`);
  return day;
}

/**
 * Consumption's view of a day in ONE query: the cycle, which meals are
 * assigned and which are already recorded. Consumption runs inside a
 * transaction at hosted latency, so its query count is budgeted
 * (tests/integration/round-trips.test.ts).
 */
async function findDayForConsumption(target: Target) {
  const [day] = await db.$queryRaw<
    { id: string; cycleId: string; cycleName: string; cycleStatus: string; assigned: string[]; recorded: string[] }[]
  >`
    SELECT cd.id, c.id AS "cycleId", c.name AS "cycleName", c.status::text AS "cycleStatus",
           COALESCE((SELECT array_agg(ma.meal_type::text) FROM meal_assignments ma WHERE ma.cycle_day_id = cd.id), '{}') AS assigned,
           COALESCE((SELECT array_agg(pr.meal_type::text) FROM production_runs pr WHERE pr.cycle_day_id = cd.id), '{}') AS recorded
    FROM cycle_days cd
    JOIN cycles c ON c.id = cd.cycle_id
    WHERE cd.cycle_id = ${target.cycleId}::uuid AND cd.day_number = ${target.dayNumber}
  `;
  if (!day) throw notFound(`Day ${target.dayNumber} of this cycle`);
  return day;
}

const ordered = (meals: Iterable<string>) => MEAL_ORDER.filter((meal) => [...meals].includes(meal));

export async function consumeProduction(target: Target, input: ConsumeProductionInput, context: Context) {
  assertCan(context.actor, "production:write");

  const day = await findDayForConsumption(target);
  if (day.cycleStatus === "DRAFT") {
    throw unprocessable("Publish the cycle before recording production against it.", { status: day.cycleStatus });
  }

  const assigned = new Set(day.assigned);
  const recorded = new Set(day.recorded);

  if (input.meals) {
    const already = input.meals.filter((meal) => recorded.has(meal));
    if (already.length) {
      throw conflict(`${already.map((m) => MEAL_NAMES[m as MealType]).join(", ")} for day ${target.dayNumber} is already recorded against stock.`, {
        meals: already,
      });
    }
  }
  const meals = ordered(input.meals ?? [...assigned].filter((meal) => !recorded.has(meal))) as MealType[];
  if (!meals.length) {
    throw assigned.size
      ? conflict(`Production for day ${target.dayNumber} is already recorded against stock.`, { meals: [...recorded] })
      : unprocessable(`Day ${target.dayNumber} has no meal assignments to produce.`);
  }

  const demandLines = await getDayDemandInputs(day.id, meals);
  if (!demandLines.length) {
    throw unprocessable(`Day ${target.dayNumber} has no meal assignments to produce.`);
  }

  const contexts = await getIngredientContexts([...new Set(demandLines.map((line) => line.ingredientId))]);
  const { demand, exceptions } = aggregateDemand(demandLines, contexts);

  if (!demand.length) {
    throw unprocessable("No consumable ingredient quantities could be calculated for this day.", { exceptions });
  }

  const reference = input.reference ?? `Production ${day.cycleName} day ${target.dayNumber}`;
  const nameById = new Map(demand.map((item) => [item.ingredientId, item.ingredientName]));

  try {
    return await db.$transaction(async (tx) => {
      // Claim the meals first: a concurrent run for the same meals fails here,
      // on the unique key, before any stock moves.
      await tx.productionRun.createMany({
        data: meals.map((mealType) => ({
          cycleDayId: day.id,
          mealType,
          reference,
          ingredientCount: demand.length,
          negativeOverride: input.allowNegative,
          recordedById: context.actor.id,
        })),
      });

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
          meals,
          ingredientCount: movements.length,
          allowNegative: input.allowNegative,
        },
        requestId: context.requestId,
      });

      return {
        cycleId: target.cycleId,
        dayNumber: target.dayNumber,
        meals,
        consumed: movements,
        // Ingredients we could not convert are reported, never silently skipped.
        exceptions,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(`Production for day ${target.dayNumber} was just recorded by someone else.`);
    }
    throw error;
  }
}

/**
 * BR-31 — what a day's unrecorded meals will take from stock, without moving
 * anything. Published for the run sheet's morning stock check.
 */
export async function previewDayStock(target: Target) {
  const day = await findDay(target);
  const recorded = new Set(day.productionRuns.map((run) => run.mealType));
  const pending = ordered(day.assignments.map((a) => a.mealType).filter((meal) => !recorded.has(meal))) as MealType[];

  const runs = ordered(recorded).map((mealType) => {
    const run = day.productionRuns.find((r) => r.mealType === mealType)!;
    return {
      mealType,
      recordedAt: run.recordedAt.toISOString(),
      recordedBy: run.recordedBy?.name ?? null,
      negativeOverride: run.negativeOverride,
    };
  });

  const base = {
    cycleId: target.cycleId,
    dayNumber: target.dayNumber,
    cycleStatus: day.cycle.status,
    assignedMeals: ordered(day.assignments.map((a) => a.mealType)) as MealType[],
    pendingMeals: pending,
    runs,
  };
  if (!pending.length) return { ...base, lines: [], exceptions: [] };

  const demandLines = await getDayDemandInputs(day.id, pending);
  const contexts = await getIngredientContexts([...new Set(demandLines.map((line) => line.ingredientId))]);
  const { demand, exceptions } = aggregateDemand(demandLines, contexts);

  const lines = demand
    .map((item) => {
      const onHand = contexts.get(item.ingredientId)?.stockOnHand ?? 0;
      const round = (value: number) => Math.round(value * 1000) / 1000;
      return {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        unit: item.unit,
        needed: round(item.quantity),
        onHand: round(onHand),
        shortBy: round(Math.max(0, item.quantity - onHand)),
      };
    })
    // Shortages first, then alphabetical: the morning question is "what's missing?"
    .sort((a, b) => Number(b.shortBy > 0) - Number(a.shortBy > 0) || a.ingredientName.localeCompare(b.ingredientName));

  return { ...base, lines, exceptions };
}

export type DayStock = Awaited<ReturnType<typeof previewDayStock>>;
