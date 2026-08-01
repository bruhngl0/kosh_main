import { describe, expect, it } from "vitest";
import {
  aggregateDemand,
  buildPurchasePlan,
  type DemandLine,
  type IngredientContext,
} from "@/modules/procurement/domain/demand";

// BR-6, BR-7, §6.2

const context = (overrides: Partial<IngredientContext> & { ingredientId: string }): IngredientContext => ({
  ingredientName: "Ingredient",
  stockUnit: "kg",
  stockOnHand: 0,
  preferredVendorId: "vendor-1",
  preferredVendorName: "Russel Market",
  purchaseUnit: "kg",
  unitCost: 100,
  ...overrides,
});

const contexts = (...items: IngredientContext[]) => new Map(items.map((item) => [item.ingredientId, item]));

const line = (overrides: Partial<DemandLine> & { ingredientId: string }): DemandLine => ({
  ingredientName: "Ingredient",
  quantity: 1,
  unit: "kg",
  servings: 1,
  ...overrides,
});

describe("aggregateDemand (BR-6)", () => {
  it("multiplies per-serving quantity by servings", () => {
    const { demand } = aggregateDemand(
      [line({ ingredientId: "a", quantity: 0.15, unit: "kg", servings: 37 })],
      contexts(context({ ingredientId: "a", ingredientName: "Chicken thigh" })),
    );
    expect(demand).toEqual([
      { ingredientId: "a", ingredientName: "Chicken thigh", quantity: 5.55, unit: "kg" },
    ]);
  });

  // The headline bug: recipes author in grams, stock is held in kilograms.
  it("converts recipe units into the ingredient stock unit", () => {
    const { demand } = aggregateDemand(
      [line({ ingredientId: "a", quantity: 150, unit: "g", servings: 37 })],
      contexts(context({ ingredientId: "a", stockUnit: "kg" })),
    );
    expect(demand[0].quantity).toBe(5.55);
    expect(demand[0].unit).toBe("kg");
  });

  it("sums lines that arrive in different units", () => {
    const { demand } = aggregateDemand(
      [
        line({ ingredientId: "a", quantity: 500, unit: "g", servings: 1 }),
        line({ ingredientId: "a", quantity: 1, unit: "kg", servings: 1 }),
      ],
      contexts(context({ ingredientId: "a", stockUnit: "kg" })),
    );
    expect(demand[0].quantity).toBe(1.5);
  });

  it("aggregates the same ingredient across several recipes", () => {
    const { demand } = aggregateDemand(
      [
        line({ ingredientId: "a", quantity: 2, servings: 10 }),
        line({ ingredientId: "a", quantity: 3, servings: 10 }),
      ],
      contexts(context({ ingredientId: "a" })),
    );
    expect(demand).toHaveLength(1);
    expect(demand[0].quantity).toBe(50);
  });

  // §6.2 — refuse rather than invent.
  it("reports an exception instead of guessing an unconvertible unit", () => {
    const { demand, exceptions } = aggregateDemand(
      [line({ ingredientId: "a", quantity: 4, unit: "bunch", servings: 5 })],
      contexts(context({ ingredientId: "a", ingredientName: "Coriander", stockUnit: "kg" })),
    );
    expect(demand).toEqual([]);
    expect(exceptions).toEqual([
      { ingredientId: "a", ingredientName: "Coriander", from: "bunch", to: "kg", quantity: 20 },
    ]);
  });

  it("keeps convertible lines when a sibling line is unconvertible", () => {
    const { demand, exceptions } = aggregateDemand(
      [
        line({ ingredientId: "a", quantity: 100, unit: "g", servings: 1 }),
        line({ ingredientId: "b", quantity: 1, unit: "bunch", servings: 1 }),
      ],
      contexts(
        context({ ingredientId: "a", ingredientName: "Rice", stockUnit: "kg" }),
        context({ ingredientId: "b", ingredientName: "Coriander", stockUnit: "kg" }),
      ),
    );
    expect(demand).toHaveLength(1);
    expect(exceptions).toHaveLength(1);
  });

  it("passes opaque units through when stock uses the same unit", () => {
    const { demand, exceptions } = aggregateDemand(
      [line({ ingredientId: "a", quantity: 2, unit: "bunch", servings: 3 })],
      contexts(context({ ingredientId: "a", stockUnit: "bunch" })),
    );
    expect(exceptions).toEqual([]);
    expect(demand[0].quantity).toBe(6);
  });

  it("skips lines for ingredients it has no context for", () => {
    const { demand } = aggregateDemand([line({ ingredientId: "ghost" })], contexts());
    expect(demand).toEqual([]);
  });
});

describe("buildPurchasePlan (BR-7)", () => {
  it("orders the shortfall, not the whole demand", () => {
    const plan = buildPurchasePlan(
      [{ ingredientId: "a", ingredientName: "Rice", quantity: 10, unit: "kg" }],
      contexts(context({ ingredientId: "a", ingredientName: "Rice", stockOnHand: 4 })),
    );
    expect(plan.groups[0].lines[0].requestedQty).toBe(6);
  });

  it("omits ingredients already covered by stock", () => {
    const plan = buildPurchasePlan(
      [{ ingredientId: "a", ingredientName: "Rice", quantity: 3, unit: "kg" }],
      contexts(context({ ingredientId: "a", stockOnHand: 8 })),
    );
    expect(plan.groups).toEqual([]);
    expect(plan.covered).toHaveLength(1);
  });

  it("groups lines by preferred vendor", () => {
    const plan = buildPurchasePlan(
      [
        { ingredientId: "a", ingredientName: "Salmon", quantity: 2, unit: "kg" },
        { ingredientId: "b", ingredientName: "Prawns", quantity: 1, unit: "kg" },
        { ingredientId: "c", ingredientName: "Spinach", quantity: 1, unit: "kg" },
      ],
      contexts(
        context({ ingredientId: "a", ingredientName: "Salmon", preferredVendorId: "fish", preferredVendorName: "Fish Stall" }),
        context({ ingredientId: "b", ingredientName: "Prawns", preferredVendorId: "fish", preferredVendorName: "Fish Stall" }),
        context({ ingredientId: "c", ingredientName: "Spinach", preferredVendorId: "veg", preferredVendorName: "Namdhari" }),
      ),
    );
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.find((group) => group.vendorId === "fish")?.lines).toHaveLength(2);
  });

  // The prototype dropped these silently.
  it("surfaces ingredients with no preferred vendor instead of dropping them", () => {
    const plan = buildPurchasePlan(
      [{ ingredientId: "a", ingredientName: "Label paper", quantity: 4, unit: "roll" }],
      contexts(
        context({
          ingredientId: "a",
          ingredientName: "Label paper",
          stockUnit: "roll",
          purchaseUnit: null,
          preferredVendorId: null,
          preferredVendorName: null,
        }),
      ),
    );
    expect(plan.groups).toEqual([]);
    expect(plan.unsourced).toHaveLength(1);
    expect(plan.unsourced[0].ingredientName).toBe("Label paper");
  });

  it("converts the shortfall into the vendor purchase unit", () => {
    const plan = buildPurchasePlan(
      [{ ingredientId: "a", ingredientName: "Miso", quantity: 800, unit: "g" }],
      contexts(context({ ingredientId: "a", stockUnit: "g", purchaseUnit: "kg", stockOnHand: 300, unitCost: 650 })),
    );
    const purchaseLine = plan.groups[0].lines[0];
    expect(purchaseLine.requestedQty).toBe(0.5);
    expect(purchaseLine.unit).toBe("kg");
    expect(purchaseLine.requiredInStockUnit).toBe(500);
    expect(purchaseLine.stockUnit).toBe("g");
  });

  it("costs each line and totals the vendor group", () => {
    const plan = buildPurchasePlan(
      [
        { ingredientId: "a", ingredientName: "Salmon", quantity: 2, unit: "kg" },
        { ingredientId: "b", ingredientName: "Prawns", quantity: 1, unit: "kg" },
      ],
      contexts(
        context({ ingredientId: "a", preferredVendorId: "fish", unitCost: 1400 }),
        context({ ingredientId: "b", preferredVendorId: "fish", unitCost: 900 }),
      ),
    );
    expect(plan.groups[0].estimatedCost).toBe(2 * 1400 + 1 * 900);
  });

  it("leaves cost null when no vendor price is known", () => {
    const plan = buildPurchasePlan(
      [{ ingredientId: "a", ingredientName: "Rice", quantity: 2, unit: "kg" }],
      contexts(context({ ingredientId: "a", unitCost: null })),
    );
    expect(plan.groups[0].lines[0].lineCost).toBeNull();
    expect(plan.groups[0].estimatedCost).toBe(0);
  });

  it("reports an exception when the shortfall cannot reach the purchase unit", () => {
    const plan = buildPurchasePlan(
      [{ ingredientId: "a", ingredientName: "Coriander", quantity: 5, unit: "bunch" }],
      contexts(context({ ingredientId: "a", ingredientName: "Coriander", stockUnit: "bunch", purchaseUnit: "kg" })),
    );
    expect(plan.groups).toEqual([]);
    expect(plan.exceptions).toEqual([
      { ingredientId: "a", ingredientName: "Coriander", from: "bunch", to: "kg", quantity: 5 },
    ]);
  });
});
