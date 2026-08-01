import { describe, expect, it } from "vitest";
import {
  blendedDailyRate,
  calculateFoodCost,
  formatInr,
  totalSubscribers,
  type CostLine,
  type PlanEnrolment,
} from "@/modules/procurement/domain/food-cost";

// BR-17

/** The roster the prototype hardcoded — Kosh_Inventory.html:872. */
const PROTOTYPE_ROSTER: PlanEnrolment[] = [
  { planName: "Full", dailyRate: 2400, subscriberCount: 22 },
  { planName: "Standard", dailyRate: 1800, subscriberCount: 10 },
  { planName: "Light", dailyRate: 1600, subscriberCount: 5 },
];

const costLine = (overrides: Partial<CostLine> = {}): CostLine => ({
  ingredientId: "a",
  ingredientName: "Ingredient",
  category: "protein",
  frequency: "weekly",
  vendorId: "v1",
  vendorName: "Fish Stall",
  cost: 1000,
  ...overrides,
});

describe("subscriber roll-up", () => {
  it("totals subscribers across plans", () => {
    expect(totalSubscribers(PROTOTYPE_ROSTER)).toBe(37);
  });

  // Reproduces (22×2400 + 10×1800 + 5×1600) / 37 from the prototype.
  it("derives the blended rate the prototype hardcoded", () => {
    expect(blendedDailyRate(PROTOTYPE_ROSTER)).toBeCloseTo(78800 / 37, 2);
  });

  it("handles an empty roster without dividing by zero", () => {
    expect(blendedDailyRate([])).toBe(0);
    expect(totalSubscribers([])).toBe(0);
  });
});

describe("calculateFoodCost", () => {
  const base = {
    enrolments: PROTOTYPE_ROSTER,
    productionDays: 5,
    mealsPerDay: 4,
    targetPercent: 30,
  };

  it("matches the prototype's weekly revenue", () => {
    const result = calculateFoodCost({ ...base, lines: [] });
    expect(result.totalRevenue).toBe(78800 * 5);
    expect(result.subscriberCount).toBe(37);
  });

  it("totals spend and derives the food cost percentage", () => {
    const result = calculateFoodCost({
      ...base,
      lines: [costLine({ cost: 60000 }), costLine({ ingredientId: "b", cost: 30000 })],
    });
    expect(result.totalSpend).toBe(90000);
    expect(result.foodCostPercent).toBeCloseTo((90000 / 394000) * 100, 2);
  });

  it("flags when spend is over target", () => {
    const under = calculateFoodCost({ ...base, lines: [costLine({ cost: 50000 })] });
    const over = calculateFoodCost({ ...base, lines: [costLine({ cost: 200000 })] });
    expect(under.withinTarget).toBe(true);
    expect(over.withinTarget).toBe(false);
  });

  it("computes cost per subscriber and per meal", () => {
    const result = calculateFoodCost({ ...base, lines: [costLine({ cost: 37000 })] });
    expect(result.costPerSubscriber).toBe(1000);
    // 37 subscribers × 4 meals × 5 days = 740 meals
    expect(result.costPerMeal).toBeCloseTo(37000 / 740, 2);
  });

  it("computes ingredient margin", () => {
    const result = calculateFoodCost({ ...base, lines: [costLine({ cost: 100000 })] });
    expect(result.ingredientMargin).toBe(394000 - 100000);
  });

  it("groups spend by category, vendor, and frequency with shares", () => {
    const result = calculateFoodCost({
      ...base,
      lines: [
        costLine({ category: "protein", vendorName: "Fish Stall", frequency: "daily", cost: 750 }),
        costLine({ ingredientId: "b", category: "produce", vendorName: "Namdhari", frequency: "daily", cost: 250 }),
      ],
    });

    expect(result.byCategory).toEqual([
      { key: "protein", cost: 750, share: 75 },
      { key: "produce", cost: 250, share: 25 },
    ]);
    expect(result.byVendor.map((group) => group.key)).toEqual(["Fish Stall", "Namdhari"]);
    expect(result.byFrequency).toEqual([{ key: "daily", cost: 1000, share: 100 }]);
  });

  it("labels lines with no vendor rather than dropping them", () => {
    const result = calculateFoodCost({
      ...base,
      lines: [costLine({ vendorId: null, vendorName: null, cost: 500 })],
    });
    expect(result.byVendor).toEqual([{ key: "Unassigned", cost: 500, share: 100 }]);
  });

  it("survives an empty roster without producing NaN or Infinity", () => {
    const result = calculateFoodCost({ ...base, enrolments: [], lines: [costLine({ cost: 500 })] });
    expect(result.totalRevenue).toBe(0);
    expect(result.foodCostPercent).toBe(0);
    expect(result.costPerSubscriber).toBe(0);
    expect(result.costPerMeal).toBe(0);
    expect(result.withinTarget).toBe(false);
  });
});

describe("formatInr", () => {
  it("formats with Indian digit grouping", () => {
    expect(formatInr(394000)).toBe("₹3,94,000");
    expect(formatInr(1000)).toBe("₹1,000");
  });
});
