import { describe, expect, it } from "vitest";
import {
  buildMonthView,
  cashAlert,
  daysInMonth,
  foodCost,
  isRecurringPaid,
  kitchenDate,
  kitchenMonthRange,
  monthWeeks,
  resolveOpeningBalance,
  shiftMonth,
  toCsv,
  type LedgerEntry,
} from "@/modules/finance/domain/cash-flow";
import { createCashTransactionSchema, createRecurringCostSchema } from "@/shared/schemas/finance";

// BR-19..BR-22

let seq = 0;
const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${++seq}`,
  date: "2026-11-05",
  direction: "OUT",
  category: "Miscellaneous",
  description: "Something",
  amount: 100,
  notes: null,
  purchaseOrderId: null,
  recurringCostId: null,
  createdAt: `2026-11-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
  ...overrides,
});

const none = { amount: 0, source: "none" as const };

describe("months", () => {
  it("knows month lengths, including leap February", () => {
    expect(daysInMonth("2026-11")).toBe(30);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
  });

  it("shifts across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("splits a month into fixed day ranges", () => {
    expect(monthWeeks("2026-11")).toEqual([
      { start: 1, end: 7 },
      { start: 8, end: 14 },
      { start: 15, end: 21 },
      { start: 22, end: 28 },
      { start: 29, end: 30 },
    ]);
    expect(monthWeeks("2026-02")).toHaveLength(4);
  });
});

describe("kitchen-local dates", () => {
  // 23:00 UTC on the 30th is 04:30 IST on the 1st — the bug the prototype had.
  it("dates an instant in Bengaluru time, not UTC", () => {
    expect(kitchenDate(new Date("2026-11-30T23:00:00Z"))).toBe("2026-12-01");
    expect(kitchenDate(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
  });

  it("spans a month from IST midnight to IST midnight", () => {
    const { from, to } = kitchenMonthRange("2026-11");
    expect(from.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
});

describe("BR-20 opening balance", () => {
  it("uses the hand-set figure when there is one", () => {
    const result = resolveOpeningBalance("2026-11", new Map([["2026-11", 50_000]]), new Map([["2026-10", 999]]));
    expect(result).toEqual({ amount: 50_000, source: "set" });
  });

  it("is zero with no earlier history", () => {
    expect(resolveOpeningBalance("2026-11", new Map(), new Map())).toEqual(none);
  });

  it("carries forward through every earlier month", () => {
    const handSet = new Map([["2026-08", 100_000]]);
    const nets = new Map([
      ["2026-08", 20_000],
      ["2026-09", -5_000],
      ["2026-10", 7_500.5],
    ]);
    expect(resolveOpeningBalance("2026-11", handSet, nets)).toEqual({ amount: 122_500.5, source: "carried" });
  });

  it("restarts the chain at a later hand-set month", () => {
    const handSet = new Map([
      ["2026-08", 100_000],
      ["2026-10", 10_000],
    ]);
    const nets = new Map([
      ["2026-08", 20_000],
      ["2026-09", 30_000],
      ["2026-10", 1_000],
    ]);
    expect(resolveOpeningBalance("2026-11", handSet, nets).amount).toBe(11_000);
  });

  it("ignores later months", () => {
    const result = resolveOpeningBalance("2026-09", new Map([["2026-12", 1]]), new Map([["2026-10", 5]]));
    expect(result).toEqual(none);
  });
});

describe("BR-22 fixed costs", () => {
  const rent = { id: "r1", name: "Kitchen rent", category: "Rent", amount: 85_000 };

  it("is paid when an expense was posted from it", () => {
    expect(isRecurringPaid(rent, [entry({ recurringCostId: "r1", description: "anything" })])).toBe(true);
  });

  it("is paid when a hand-logged expense names it", () => {
    expect(isRecurringPaid(rent, [entry({ description: "KITCHEN RENT — November" })])).toBe(true);
  });

  it("is not paid by income that happens to mention it", () => {
    expect(isRecurringPaid(rent, [entry({ direction: "IN", description: "Kitchen rent refund" })])).toBe(false);
  });

  it("is not paid by an unrelated expense in the same category", () => {
    expect(isRecurringPaid(rent, [entry({ category: "Rent", description: "Storage unit" })])).toBe(false);
  });
});

describe("buildMonthView", () => {
  const view = buildMonthView({
    month: "2026-11",
    opening: { amount: 10_000, source: "set" },
    entries: [
      entry({ id: "late", date: "2026-11-20", direction: "OUT", category: "Ingredients", amount: 3_000 }),
      entry({ id: "sub", date: "2026-11-01", direction: "IN", category: "Subscriptions", amount: 10_000 }),
      entry({ id: "rent", date: "2026-11-01", direction: "OUT", category: "Rent", amount: 20_000.1, recurringCostId: "r1" }),
      entry({ id: "other-month", date: "2026-12-01", direction: "IN", amount: 1_000_000 }),
    ],
    recurring: [
      { id: "r1", name: "Kitchen rent", category: "Rent", amount: 20_000 },
      { id: "r2", name: "Salaries", category: "Kitchen Staff", amount: 50_000 },
    ],
  });

  it("orders by date and keeps a running balance", () => {
    expect(view.rows.map((r) => r.id)).toEqual(["sub", "rent", "late"]);
    expect(view.rows.map((r) => r.balance)).toEqual([20_000, -0.1, -3_000.1]);
  });

  it("ignores rows outside the month", () => {
    expect(view.totals.income).toBe(10_000);
  });

  it("totals without floating-point dust", () => {
    expect(view.totals).toMatchObject({ income: 10_000, expenses: 23_000.1, net: -13_000.1, closing: -3_000.1 });
  });

  it("rolls weeks up with a closing balance each", () => {
    expect(view.weeks[0]).toMatchObject({ count: 2, income: 10_000, expenses: 20_000.1, closing: -0.1 });
    expect(view.weeks[2]).toMatchObject({ count: 1, expenses: 3_000, closing: -3_000.1 });
    expect(view.weeks[4].closing).toBe(-3_000.1);
  });

  it("gives a balance for every day", () => {
    expect(view.daily).toHaveLength(30);
    expect(view.daily[0].balance).toBe(-0.1);
    expect(view.daily[29].balance).toBe(view.totals.closing);
  });

  it("projects the balance after unpaid fixed costs", () => {
    expect(view.recurring.map((r) => r.paid)).toEqual([true, false]);
    expect(view.unpaidFixedCosts).toBe(50_000);
    expect(view.projectedClosing).toBe(-53_000.1);
  });

  it("computes food cost against subscription revenue", () => {
    expect(view.foodCost).toEqual({ percent: 30, target: 30, level: "ok" });
  });

  it("flags a negative closing balance", () => {
    expect(view.alert.level).toBe("danger");
  });
});

describe("danger flags", () => {
  it("escalates by severity", () => {
    expect(cashAlert(-1, -1).reason).toBe("negative-closing");
    expect(cashAlert(50_000, -1).reason).toBe("fixed-costs-exceed-balance");
    expect(cashAlert(500_000, 99_999).reason).toBe("low-balance");
    expect(cashAlert(500_000, 100_000).reason).toBe("healthy");
  });

  it("grades food cost against the target", () => {
    expect(foodCost(0, 0).percent).toBeNull();
    expect(foodCost(31, 100, 30).level).toBe("warn");
    expect(foodCost(35.1, 100, 30).level).toBe("danger");
    expect(foodCost(40, 100, 45).level).toBe("ok");
  });
});

describe("CSV", () => {
  it("neutralises formula injection in text but leaves negative numbers alone", () => {
    const view = buildMonthView({
      month: "2026-11",
      opening: none,
      entries: [entry({ description: '=HYPERLINK("x")', notes: "-note", amount: 500 })],
      recurring: [],
    });
    const [, line] = toCsv(view.rows).split("\r\n");
    expect(line).toBe(`"2026-11-05","'=HYPERLINK(""x"")","Miscellaneous","Expense",500.00,-500.00,"'-note"`);
  });
});

describe("BR-19 contracts", () => {
  const valid = { date: "2026-11-05", direction: "IN", category: "Subscriptions", description: "Week 1", amount: 10 };

  it("accepts a well-formed transaction and rounds to paise", () => {
    expect(createCashTransactionSchema.parse({ ...valid, amount: 10.005 }).amount).toBe(10.01);
  });

  it("rejects a category from the other direction", () => {
    expect(createCashTransactionSchema.safeParse({ ...valid, category: "Rent" }).success).toBe(false);
  });

  it("rejects zero, negative, and impossible dates", () => {
    expect(createCashTransactionSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(createCashTransactionSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false);
    expect(createCashTransactionSchema.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(false);
  });

  it("only allows expense categories for fixed costs", () => {
    expect(createRecurringCostSchema.safeParse({ name: "Rent", category: "Rent", amount: 1 }).success).toBe(true);
    expect(createRecurringCostSchema.safeParse({ name: "X", category: "Subscriptions", amount: 1 }).success).toBe(false);
  });
});
