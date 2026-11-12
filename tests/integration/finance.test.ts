import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { makeIngredient, makeVendor } from "../support/factories";
import {
  createCashTransaction,
  createRecurringCost,
  deleteCashTransaction,
  getMonthView,
  importPurchaseOrders,
  postRecurringCost,
  setOpeningBalance,
  updateCashTransaction,
} from "@/modules/finance";
import type { Actor } from "@/server/actor";

/** BR-19..BR-22 against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

const tx = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-11-05",
  direction: "IN" as const,
  category: "Subscriptions",
  description: "Week 1",
  amount: 100_000,
  notes: null,
  ...overrides,
});

describe("ledger", () => {
  it("records transactions, audits them, and keeps a running balance", async () => {
    await setOpeningBalance("2026-11", 50_000, context());
    await createCashTransaction(tx(), context());
    await createCashTransaction(tx({ direction: "OUT", category: "Rent", description: "Rent", amount: 85_000.5, date: "2026-11-06" }), context());

    const view = await getMonthView("2026-11");
    expect(view.opening).toEqual({ amount: 50_000, source: "set" });
    expect(view.rows.map((r) => r.balance)).toEqual([150_000, 64_999.5]);
    expect(view.totals.closing).toBe(64_999.5);

    const audits = await db.auditEvent.count({ where: { action: "cash_transaction.created" } });
    expect(audits).toBe(2);
  });

  it("carries the closing balance into the next month", async () => {
    await setOpeningBalance("2026-10", 10_000, context());
    await createCashTransaction(tx({ date: "2026-10-31", amount: 5_000 }), context());

    expect((await getMonthView("2026-11")).opening).toEqual({ amount: 15_000, source: "carried" });

    // Clearing the hand-set figure falls back to carry-forward from nothing.
    await setOpeningBalance("2026-10", null, context());
    expect((await getMonthView("2026-11")).opening.amount).toBe(5_000);
  });

  it("re-checks category against direction when only one changes", async () => {
    const created = await createCashTransaction(tx(), context());
    await expect(updateCashTransaction(created.id, { direction: "OUT" }, context())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const moved = await updateCashTransaction(created.id, { direction: "OUT", category: "Rent" }, context());
    expect(moved).toMatchObject({ direction: "OUT", category: "Rent" });
  });

  it("deletes with an audit snapshot of what was removed", async () => {
    const created = await createCashTransaction(tx(), context());
    await deleteCashTransaction(created.id, context());
    expect(await db.cashTransaction.count()).toBe(0);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "cash_transaction.deleted" } });
    expect(audit.before).toMatchObject({ description: "Week 1" });
  });

  it("enforces positive amounts in the database itself", async () => {
    await expect(
      db.cashTransaction.create({
        data: { date: new Date("2026-11-01"), direction: "IN", category: "Subscriptions", description: "x", amount: -1 },
      }),
    ).rejects.toThrow(/cash_transactions_amount_positive/);
  });

  it("refuses writes from roles without finance:write", async () => {
    const viewer = await seedActor("PROCUREMENT");
    await expect(createCashTransaction(tx(), { actor: viewer, requestId: "r" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("BR-22 fixed costs", () => {
  it("posts once per month and then shows as paid", async () => {
    const rent = await createRecurringCost({ name: "Kitchen rent", category: "Rent", amount: 85_000 }, context());

    let view = await getMonthView("2026-11");
    expect(view.unpaidFixedCosts).toBe(85_000);

    await postRecurringCost(rent.id, { month: "2026-11", date: "2026-11-05" }, context());
    view = await getMonthView("2026-11");
    expect(view.recurring[0].paid).toBe(true);
    expect(view.rows[0]).toMatchObject({ category: "Rent", amount: 85_000, recurringCostId: rent.id });

    await expect(postRecurringCost(rent.id, { month: "2026-11" }, context())).rejects.toMatchObject({ code: "CONFLICT" });
    // A different month is fine.
    await postRecurringCost(rent.id, { month: "2026-12" }, context());
  });

  it("rejects a payment date outside the month", async () => {
    const rent = await createRecurringCost({ name: "Kitchen rent", category: "Rent", amount: 1 }, context());
    await expect(postRecurringCost(rent.id, { month: "2026-11", date: "2026-12-01" }, context())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("BR-21 purchase order import", () => {
  async function receivedOrder(receivedAt: Date, lines: { qty: number; cost: number | null }[]) {
    const vendor = await makeVendor({ name: `Vendor ${Math.random().toString(36).slice(2, 7)}` });
    const ingredients = await Promise.all(lines.map((_, i) => makeIngredient({ name: `Item ${vendor.id}-${i}`, defaultUnit: "kg" })));
    return db.purchaseOrder.create({
      data: {
        vendorId: vendor.id,
        status: "RECEIVED",
        receivedAt,
        lines: {
          create: lines.map((line, i) => ({
            ingredientId: ingredients[i].id,
            requestedQty: line.qty,
            receivedQty: line.qty,
            unit: "kg",
            unitCost: line.cost,
          })),
        },
      },
    });
  }

  it("imports received orders once, priced on received quantity, dated in IST", async () => {
    // 20:00 UTC on 31 Oct is 01:30 IST on 1 Nov — belongs to November.
    const order = await receivedOrder(new Date("2026-10-31T20:00:00Z"), [
      { qty: 2.5, cost: 320 },
      { qty: 1, cost: null },
    ]);
    await receivedOrder(new Date("2026-10-31T17:00:00Z"), [{ qty: 1, cost: 999 }]); // 22:30 IST, October

    let view = await getMonthView("2026-11");
    expect(view.pendingPurchaseOrders).toMatchObject({ count: 1, total: 800 });

    const first = await importPurchaseOrders("2026-11", context());
    expect(first).toMatchObject({ imported: 1, total: 800 });

    view = await getMonthView("2026-11");
    expect(view.pendingPurchaseOrders.count).toBe(0);
    expect(view.rows[0]).toMatchObject({
      date: "2026-11-01",
      category: "Ingredients",
      amount: 800,
      purchaseOrderId: order.id,
      notes: "1 of 2 lines had no unit cost and are not included",
    });

    // Idempotent.
    expect(await importPurchaseOrders("2026-11", context())).toMatchObject({ imported: 0 });
    expect(await db.cashTransaction.count()).toBe(1);
  });

  it("survives two imports racing", async () => {
    await receivedOrder(new Date("2026-11-10T06:00:00Z"), [{ qty: 1, cost: 100 }]);
    await Promise.allSettled([importPurchaseOrders("2026-11", context()), importPurchaseOrders("2026-11", context())]);
    expect(await db.cashTransaction.count()).toBe(1);
  });
});
