/**
 * BR-17 — food cost and P&L.
 * Ported from Kosh_Inventory.html:872.
 *
 * The prototype hardcoded weekly revenue as
 *   subs × ((22×2400 + 10×1800 + 5×1600) / 37) × 5
 * — a blended daily rate frozen from one particular roster of 37 households.
 * That number goes stale the moment somebody subscribes or cancels. Here the
 * rate comes from actual subscription plans.
 *
 * Pure: no I/O. All money is INR.
 */

import { round } from "@/shared/units";

export type PlanEnrolment = {
  planName: string;
  /** INR per subscriber per production day. */
  dailyRate: number;
  subscriberCount: number;
};

export type CostLine = {
  ingredientId: string;
  ingredientName: string;
  category: string;
  frequency: string;
  vendorId: string | null;
  vendorName: string | null;
  /** Extended cost for this line over the period. */
  cost: number;
};

export type FoodCostInput = {
  lines: CostLine[];
  enrolments: PlanEnrolment[];
  /** Days of production in the period. The prototype assumed 5. */
  productionDays: number;
  /** Meals served per subscriber per production day. */
  mealsPerDay: number;
  /** Target food cost as a percentage of revenue. */
  targetPercent: number;
};

export type FoodCostBreakdown = {
  totalSpend: number;
  totalRevenue: number;
  subscriberCount: number;
  foodCostPercent: number;
  targetPercent: number;
  withinTarget: boolean;
  costPerSubscriber: number;
  costPerMeal: number;
  ingredientMargin: number;
  byCategory: { key: string; cost: number; share: number }[];
  byVendor: { key: string; cost: number; share: number }[];
  byFrequency: { key: string; cost: number; share: number }[];
};

export const blendedDailyRate = (enrolments: PlanEnrolment[]): number => {
  const subscribers = totalSubscribers(enrolments);
  if (subscribers === 0) return 0;
  const revenue = enrolments.reduce((sum, plan) => sum + plan.dailyRate * plan.subscriberCount, 0);
  return round(revenue / subscribers, 2);
};

export const totalSubscribers = (enrolments: PlanEnrolment[]) =>
  enrolments.reduce((sum, plan) => sum + plan.subscriberCount, 0);

export function calculateFoodCost(input: FoodCostInput): FoodCostBreakdown {
  const totalSpend = round(
    input.lines.reduce((sum, line) => sum + line.cost, 0),
    2,
  );

  const subscriberCount = totalSubscribers(input.enrolments);
  const dailyRevenue = input.enrolments.reduce(
    (sum, plan) => sum + plan.dailyRate * plan.subscriberCount,
    0,
  );
  const totalRevenue = round(dailyRevenue * input.productionDays, 2);

  const foodCostPercent = totalRevenue > 0 ? round((totalSpend / totalRevenue) * 100, 2) : 0;
  const mealCount = subscriberCount * input.mealsPerDay * input.productionDays;

  return {
    totalSpend,
    totalRevenue,
    subscriberCount,
    foodCostPercent,
    targetPercent: input.targetPercent,
    withinTarget: totalRevenue > 0 && foodCostPercent <= input.targetPercent,
    costPerSubscriber: subscriberCount > 0 ? round(totalSpend / subscriberCount, 2) : 0,
    costPerMeal: mealCount > 0 ? round(totalSpend / mealCount, 2) : 0,
    ingredientMargin: round(totalRevenue - totalSpend, 2),
    byCategory: groupCost(input.lines, totalSpend, (line) => line.category),
    byVendor: groupCost(input.lines, totalSpend, (line) => line.vendorName ?? "Unassigned"),
    byFrequency: groupCost(input.lines, totalSpend, (line) => line.frequency),
  };
}

function groupCost(lines: CostLine[], total: number, key: (line: CostLine) => string) {
  const groups = new Map<string, number>();
  for (const line of lines) {
    const group = key(line);
    groups.set(group, round((groups.get(group) ?? 0) + line.cost, 2));
  }
  return [...groups.entries()]
    .map(([groupKey, cost]) => ({
      key: groupKey,
      cost,
      share: total > 0 ? round((cost / total) * 100, 2) : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** INR formatting, used by both server projections and the UI. */
export const formatInr = (value: number) =>
  `₹${Math.round(value).toLocaleString("en-IN")}`;
