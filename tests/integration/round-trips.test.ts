import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, seedActor } from "../support/setup-database";
import { countQueries } from "../support/query-counter";
import { fillCycle, makeCycle, makeIngredient, makeRecipe, makeVendor } from "../support/factories";
import { generatePrepTasks, consumeProduction } from "@/modules/production";
import { publishCycle } from "@/modules/cycles";
import { receivePurchaseOrder, generatePurchaseOrders, transitionPurchaseOrder } from "@/modules/procurement";
import type { Actor } from "@/server/actor";

/**
 * Round-trip budgets.
 *
 * These assert that generation and stock endpoints cost a bounded number of
 * queries REGARDLESS of how much data they touch. A per-row loop passes every
 * functional test and still breaks in production: at ~30ms hosted latency,
 * 150 sequential queries inside one transaction exceeds Prisma's 5s timeout.
 *
 * Budgets are deliberately loose — they catch a regression to per-row work,
 * not a one-query drift.
 */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

/**
 * A cycle whose every day generates prep work and consumes several ingredients.
 * `stock` defaults high so consumption succeeds; set it to 0 when the test needs
 * purchase orders to be generated.
 */
async function bigCycle(days: number, stock = 1000) {
  const vendor = await makeVendor();
  const ingredients = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      makeIngredient({
        name: `Ingredient ${index}`,
        defaultUnit: "kg",
        quantity: stock,
        vendorId: vendor.id,
      }),
    ),
  );

  const steps = [
    { stepNumber: 1, title: "Marinate", instructions: "Marinate 24hr prior", criticality: "mandatory" },
    { stepNumber: 2, title: "Ferment", instructions: "Ferment overnight", criticality: "warning" },
    { stepNumber: 3, title: "Cook", instructions: "Cook it.", criticality: "info" },
  ];

  const meals = await Promise.all(
    (["BF", "SN", "LU", "DI"] as const).map((mealType) =>
      makeRecipe({
        mealType,
        title: `Dish ${mealType}`,
        steps,
        ingredients: ingredients.map((ingredient) => ({
          ingredientId: ingredient.id,
          quantity: 100,
          unit: "g",
        })),
      }),
    ),
  );

  const cycle = await makeCycle({ durationDays: days, subscriberCount: 37 });
  await fillCycle(cycle.id, {
    BF: meals[0].version.id,
    SN: meals[1].version.id,
    LU: meals[2].version.id,
    DI: meals[3].version.id,
  });

  return { cycle, ingredients };
}

describe("prep-task generation stays bounded", () => {
  it("costs the same for 28 days as for 7", async () => {
    const small = await bigCycle(7);
    const smallRun = await countQueries(() => generatePrepTasks(small.cycle.id, context()));

    await resetDatabase();
    actor = await seedActor("ADMIN");

    const large = await bigCycle(28);
    const largeRun = await countQueries(() => generatePrepTasks(large.cycle.id, context()));

    // 28 days × 4 meals × 2 non-info steps = 224 tasks.
    expect(largeRun.result.total).toBe(224);
    expect(smallRun.result.total).toBe(56);

    // A per-row loop would make this scale with task count. It must not.
    expect(largeRun.queries).toBeLessThan(20);
    expect(largeRun.queries).toBeLessThanOrEqual(smallRun.queries + 2);
  });

  it("re-running is no more expensive than the first run", async () => {
    const { cycle } = await bigCycle(28);
    await generatePrepTasks(cycle.id, context());
    const rerun = await countQueries(() => generatePrepTasks(cycle.id, context()));
    expect(rerun.result.updated).toBe(224);
    expect(rerun.queries).toBeLessThan(20);
  });
});

describe("production consumption stays bounded", () => {
  it("costs a fixed number of queries regardless of ingredient count", async () => {
    const { cycle } = await bigCycle(2);
    await publishCycle(cycle.id, context());

    const run = await countQueries(() =>
      consumeProduction({ cycleId: cycle.id, dayNumber: 1 }, { allowNegative: false }, context()),
    );

    // 8 ingredients across 4 meals. A four-query-per-ingredient loop would be 32+.
    expect(run.result.consumed).toHaveLength(8);
    expect(run.queries).toBeLessThan(20);
  });
});

describe("purchase-order receipt stays bounded", () => {
  it("does not scale queries with line count", async () => {
    // No stock, so every ingredient needs ordering.
    const { cycle } = await bigCycle(7, 0);
    const generated = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    const order = generated.orders[0];
    expect(order).toBeDefined();
    await transitionPurchaseOrder(order.id, { status: "ORDERED" }, context());

    const run = await countQueries(() =>
      receivePurchaseOrder(
        order.id,
        { lines: order.lines.map((line) => ({ lineId: line.id, receivedQty: line.requestedQty })) },
        context(),
      ),
    );

    expect(order.lines.length).toBeGreaterThan(4);
    // One update per line is acceptable; four queries per line is not.
    expect(run.queries).toBeLessThan(order.lines.length * 2 + 12);
  });
});
