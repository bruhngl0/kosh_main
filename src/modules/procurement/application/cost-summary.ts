import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { toNumber } from "@/shared/money";
import { getWeekDemandInputs } from "@/modules/cycles";
import { getIngredientContexts, listIngredients } from "@/modules/inventory";
import { aggregateDemand } from "@/modules/procurement/domain/demand";
import { calculateFoodCost, type CostLine, type PlanEnrolment } from "@/modules/procurement/domain/food-cost";

/**
 * BR-17 — cost and P&L summary.
 *
 * Restores the prototype's cost-by-vendor, cost-by-frequency and P&L block
 * (Kosh_Inventory.html:872), which the React rewrite had reduced to category
 * totals. Revenue now comes from real subscription plans rather than the
 * hardcoded 22/10/5 constant.
 */

export async function getCostSummary(input: {
  cycleId?: string;
  weekNumber?: number;
  productionDays: number;
  mealsPerDay: number;
}) {
  const enrolments = await getPlanEnrolments();
  const cycle = input.cycleId
    ? await db.cycle.findUnique({
        where: { id: input.cycleId },
        select: { id: true, name: true, foodCostTargetPercent: true, subscriberCount: true },
      })
    : null;

  if (input.cycleId && !cycle) throw notFound("Cycle", input.cycleId);

  const targetPercent = toNumber(cycle?.foodCostTargetPercent, 30);

  const lines =
    cycle && input.weekNumber
      ? await weekDemandCostLines(cycle.id, input.weekNumber)
      : await standingCostLines();

  const breakdown = calculateFoodCost({
    lines,
    // Fall back to the cycle's roster count when nobody is on a plan yet, so
    // an unseeded plan table does not silently zero the P&L.
    enrolments: enrolments.length ? enrolments : fallbackEnrolment(cycle?.subscriberCount ?? 0),
    productionDays: input.productionDays,
    mealsPerDay: input.mealsPerDay,
    targetPercent,
  });

  return {
    basis: cycle && input.weekNumber ? "cycle-week" : "standing-reference",
    cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
    weekNumber: input.weekNumber ?? null,
    productionDays: input.productionDays,
    mealsPerDay: input.mealsPerDay,
    enrolments,
    ...breakdown,
  };
}

/** Actual demand for a cycle week, priced at preferred-vendor cost. */
async function weekDemandCostLines(cycleId: string, weekNumber: number): Promise<CostLine[]> {
  const demandLines = await getWeekDemandInputs(cycleId, weekNumber);
  if (!demandLines.length) return [];

  const contexts = await getIngredientContexts([...new Set(demandLines.map((line) => line.ingredientId))]);
  const { demand } = aggregateDemand(demandLines, contexts);

  const ingredients = await db.ingredient.findMany({
    where: { id: { in: demand.map((item) => item.ingredientId) } },
    select: { id: true, category: true, defaultFrequency: true },
  });
  const meta = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  return demand.flatMap((item) => {
    const context = contexts.get(item.ingredientId);
    const info = meta.get(item.ingredientId);
    if (!context || !info) return [];
    return [
      {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        category: info.category,
        frequency: info.defaultFrequency,
        vendorId: context.preferredVendorId,
        vendorName: context.preferredVendorName,
        cost: Math.round(item.quantity * (context.unitCost ?? 0) * 100) / 100,
      },
    ];
  });
}

/** The prototype's view: standing `Qty Needed` × unit cost across the master. */
async function standingCostLines(): Promise<CostLine[]> {
  const items = await listIngredients({ managedOnly: true });
  return items.map((item) => ({
    ingredientId: item.id,
    ingredientName: item.name,
    category: item.category,
    frequency: item.defaultFrequency,
    vendorId: item.vendor?.id ?? null,
    vendorName: item.vendor?.name ?? null,
    cost: item.standingLineCost ?? 0,
  }));
}

async function getPlanEnrolments(): Promise<PlanEnrolment[]> {
  const plans = await db.subscriptionPlan.findMany({
    where: { active: true },
    include: { _count: { select: { subscribers: true } } },
    orderBy: { dailyRate: "desc" },
  });

  return plans
    .map((plan) => ({
      planName: plan.name,
      dailyRate: toNumber(plan.dailyRate),
      subscriberCount: plan._count.subscribers,
    }))
    .filter((plan) => plan.subscriberCount > 0);
}

const fallbackEnrolment = (subscriberCount: number): PlanEnrolment[] =>
  subscriberCount > 0 ? [{ planName: "Unassigned", dailyRate: 0, subscriberCount }] : [];
