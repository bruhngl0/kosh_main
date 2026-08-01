import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { balanceOf, fillCycle, makeCycle, makeIngredient, makeRecipe, makeVendor } from "../support/factories";
import {
  generatePurchaseOrders,
  getOutreach,
  receivePurchaseOrder,
  transitionPurchaseOrder,
} from "@/modules/procurement";
import type { Actor } from "@/server/actor";

/** BR-6, BR-7, BR-12, BR-13, BR-16 against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

/** A one-week cycle whose lunch needs 150 g of chicken per serving. */
async function scenario(options: { stock?: number; subscriberCount?: number; purchaseUnit?: string } = {}) {
  const vendor = await makeVendor({ name: "Russel Market — Meat" });
  const chicken = await makeIngredient({
    name: "Chicken thigh",
    defaultUnit: "kg",
    quantity: options.stock ?? 0,
    vendorId: vendor.id,
    unitCost: 320,
    purchaseUnit: options.purchaseUnit ?? "kg",
  });

  // Authored in grams, stocked in kilograms — the conversion case (§6.2).
  const { version } = await makeRecipe({
    mealType: "LU",
    ingredients: [{ ingredientId: chicken.id, quantity: 150, unit: "g" }],
  });

  const cycle = await makeCycle({ durationDays: 7, subscriberCount: options.subscriberCount ?? 10 });
  await fillCycle(cycle.id, { LU: version.id });

  return { vendor, chicken, cycle };
}

describe("generatePurchaseOrders", () => {
  it("converts recipe units into stock units before ordering", async () => {
    const { cycle } = await scenario({ subscriberCount: 10 });

    const result = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    // 150 g × 10 servings × 7 days = 10 500 g = 10.5 kg
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].lines[0].requestedQty).toBe(10.5);
    expect(result.orders[0].lines[0].unit).toBe("kg");
  });

  it("subtracts stock on hand", async () => {
    const { cycle } = await scenario({ subscriberCount: 10, stock: 4 });
    const result = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    expect(result.orders[0].lines[0].requestedQty).toBe(6.5);
  });

  it("orders nothing when stock already covers demand", async () => {
    const { cycle } = await scenario({ subscriberCount: 10, stock: 100 });
    const result = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    expect(result.orders).toHaveLength(0);
    expect(result.covered).toHaveLength(1);
  });

  it("returns ingredients with no preferred vendor as unsourced", async () => {
    const orphan = await makeIngredient({ name: "Label paper", defaultUnit: "roll" });
    const { version } = await makeRecipe({
      mealType: "DI",
      ingredients: [{ ingredientId: orphan.id, quantity: 1, unit: "roll" }],
    });
    const cycle = await makeCycle({ durationDays: 7, cycleNumber: 2 });
    await fillCycle(cycle.id, { DI: version.id });

    const result = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    expect(result.orders).toHaveLength(0);
    expect(result.unsourced).toHaveLength(1);
    expect(result.unsourced[0].ingredientName).toBe("Label paper");
  });

  it("reports unconvertible units instead of guessing", async () => {
    const vendor = await makeVendor();
    const coriander = await makeIngredient({
      name: "Coriander",
      defaultUnit: "kg",
      vendorId: vendor.id,
    });
    const { version } = await makeRecipe({
      mealType: "SN",
      ingredients: [{ ingredientId: coriander.id, quantity: 1, unit: "bunch" }],
    });
    const cycle = await makeCycle({ durationDays: 7, cycleNumber: 3 });
    await fillCycle(cycle.id, { SN: version.id });

    const result = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    expect(result.orders).toHaveLength(0);
    expect(result.exceptions).toMatchObject([{ ingredientName: "Coriander", from: "bunch", to: "kg" }]);
  });

  // BR-16
  it("is idempotent — re-running updates rather than duplicating", async () => {
    const { cycle } = await scenario();

    await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    expect(await db.purchaseOrder.count()).toBe(1);
    expect(await db.purchaseOrderLine.count()).toBe(1);
  });

  it("never rewrites an order that has already been sent", async () => {
    const { cycle } = await scenario();
    const first = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    const orderId = first.orders[0].id;

    await transitionPurchaseOrder(orderId, { status: "ORDERED" }, context());

    // Demand doubles, but the sent order must not silently change.
    await db.mealAssignment.updateMany({ data: { servings: 20 } });
    const second = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0].status).toBe("ORDERED");

    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: orderId } });
    expect(Number(line.requestedQty)).toBe(10.5);
  });

  it("removes draft orders whose demand has disappeared", async () => {
    const { cycle } = await scenario();
    await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    expect(await db.purchaseOrder.count()).toBe(1);

    await db.mealAssignment.deleteMany({});
    await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    expect(await db.purchaseOrder.count()).toBe(0);
  });

  it("rejects a week beyond the cycle length", async () => {
    const { cycle } = await scenario();
    await expect(
      generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 9 }, context()),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});

describe("receivePurchaseOrder (BR-13)", () => {
  async function orderedScenario() {
    const { cycle, chicken } = await scenario();
    const generated = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    const order = generated.orders[0];
    await transitionPurchaseOrder(order.id, { status: "ORDERED" }, context());
    return { order, chicken };
  }

  it("creates stock when goods are received", async () => {
    const { order, chicken } = await orderedScenario();
    expect(await balanceOf(chicken.id)).toBe(0);

    const result = await receivePurchaseOrder(
      order.id,
      { lines: [{ lineId: order.lines[0].id, receivedQty: 10.5 }], reference: "Invoice 1" },
      context(),
    );

    expect(result.fullyReceived).toBe(true);
    expect(result.order.status).toBe("RECEIVED");
    expect(await balanceOf(chicken.id)).toBe(10.5);
  });

  it("leaves the order partially received when short-delivered", async () => {
    const { order, chicken } = await orderedScenario();

    const result = await receivePurchaseOrder(
      order.id,
      { lines: [{ lineId: order.lines[0].id, receivedQty: 4 }] },
      context(),
    );

    expect(result.order.status).toBe("PARTIALLY_RECEIVED");
    expect(result.order.lines[0].outstandingQty).toBe(6.5);
    expect(await balanceOf(chicken.id)).toBe(4);
  });

  it("accumulates across successive deliveries", async () => {
    const { order, chicken } = await orderedScenario();

    await receivePurchaseOrder(order.id, { lines: [{ lineId: order.lines[0].id, receivedQty: 4 }] }, context());
    const second = await receivePurchaseOrder(
      order.id,
      { lines: [{ lineId: order.lines[0].id, receivedQty: 6.5 }] },
      context(),
    );

    expect(second.order.status).toBe("RECEIVED");
    expect(await balanceOf(chicken.id)).toBe(10.5);
  });

  it("writes one RECEIVE movement per received line", async () => {
    const { order } = await orderedScenario();
    await receivePurchaseOrder(order.id, { lines: [{ lineId: order.lines[0].id, receivedQty: 5 }] }, context());

    const movements = await db.inventoryMovement.findMany({ where: { type: "RECEIVE" } });
    expect(movements).toHaveLength(1);
    expect(movements[0].reference).toContain("PO ");
    expect(movements[0].actorId).toBe(actor.id);
  });

  it("refuses to receive against a terminal order", async () => {
    const { order } = await orderedScenario();
    await receivePurchaseOrder(order.id, { lines: [{ lineId: order.lines[0].id, receivedQty: 10.5 }] }, context());

    await expect(
      receivePurchaseOrder(order.id, { lines: [{ lineId: order.lines[0].id, receivedQty: 1 }] }, context()),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("rejects a line from another order", async () => {
    const { order } = await orderedScenario();
    await expect(
      receivePurchaseOrder(
        order.id,
        { lines: [{ lineId: "00000000-0000-4000-8000-000000000000", receivedQty: 1 }] },
        context(),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("transitionPurchaseOrder (BR-12)", () => {
  it("rejects an illegal transition", async () => {
    const { cycle } = await scenario();
    const generated = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    await expect(
      transitionPurchaseOrder(generated.orders[0].id, { status: "RECEIVED" }, context()),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("directs receiving to the receive endpoint so stock is written", async () => {
    const { cycle } = await scenario();
    const generated = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());
    await transitionPurchaseOrder(generated.orders[0].id, { status: "ORDERED" }, context());

    await expect(
      transitionPurchaseOrder(generated.orders[0].id, { status: "RECEIVED" }, context()),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});

describe("getOutreach", () => {
  it("builds the full vendor message with a WhatsApp link", async () => {
    const { cycle } = await scenario();
    const generated = await generatePurchaseOrders({ cycleId: cycle.id, weekNumber: 1 }, context());

    const outreach = await getOutreach(generated.orders[0].id);

    expect(outreach.message).toContain("Kōsh Private Kitchen");
    expect(outreach.message).toContain("Chicken thigh — 10.5 kg");
    expect(outreach.message).toContain("*by 5:30 AM latest*");
    expect(outreach.whatsappUrl).toContain("https://wa.me/");
  });
});
