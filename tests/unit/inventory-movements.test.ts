import { describe, expect, it } from "vitest";
import {
  isBelowPar,
  parStatus,
  planMovement,
  reorderQuantity,
  requiresReason,
} from "@/modules/inventory/domain/movements";

// BR-8, BR-9, BR-10

const plan = (input: Parameters<typeof planMovement>[0]) => {
  const outcome = planMovement(input);
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.rejection.kind}`);
  return outcome.plan;
};

const rejection = (input: Parameters<typeof planMovement>[0]) => {
  const outcome = planMovement(input);
  if (outcome.ok) throw new Error("expected rejection");
  return outcome.rejection;
};

describe("movement direction (BR-9)", () => {
  it("RECEIVE increases the balance", () => {
    expect(plan({ type: "RECEIVE", quantity: 5, currentBalance: 2 })).toMatchObject({
      quantityDelta: 5,
      balanceAfter: 7,
    });
  });

  it("RETURN increases the balance", () => {
    expect(plan({ type: "RETURN", quantity: 1.5, currentBalance: 0 })).toMatchObject({
      quantityDelta: 1.5,
      balanceAfter: 1.5,
    });
  });

  it("CONSUME decreases the balance", () => {
    expect(plan({ type: "CONSUME", quantity: 3, currentBalance: 10 })).toMatchObject({
      quantityDelta: -3,
      balanceAfter: 7,
    });
  });

  it("WASTE decreases the balance", () => {
    expect(plan({ type: "WASTE", quantity: 2, currentBalance: 5, reason: "spoiled" })).toMatchObject({
      quantityDelta: -2,
      balanceAfter: 3,
    });
  });

  it("ADJUST sets the balance to the counted value", () => {
    expect(plan({ type: "ADJUST", quantity: 4, currentBalance: 10, reason: "stock count" })).toMatchObject({
      quantityDelta: -6,
      balanceAfter: 4,
    });
    expect(plan({ type: "ADJUST", quantity: 12, currentBalance: 10, reason: "stock count" })).toMatchObject({
      quantityDelta: 2,
      balanceAfter: 12,
    });
  });

  // The prototype bug: a signed delta let CONSUME add stock.
  it("derives direction from the type, not from the caller", () => {
    const consumed = plan({ type: "CONSUME", quantity: 5, currentBalance: 20 });
    const received = plan({ type: "RECEIVE", quantity: 5, currentBalance: 20 });
    expect(consumed.balanceAfter).toBe(15);
    expect(received.balanceAfter).toBe(25);
  });

  it("refuses a negative magnitude outright", () => {
    expect(rejection({ type: "RECEIVE", quantity: -5, currentBalance: 0 })).toEqual({
      kind: "NEGATIVE_QUANTITY",
    });
  });
});

describe("reason requirements (BR-9)", () => {
  it("requires a reason for WASTE and ADJUST", () => {
    expect(requiresReason("WASTE")).toBe(true);
    expect(requiresReason("ADJUST")).toBe(true);
    expect(requiresReason("RECEIVE")).toBe(false);
    expect(requiresReason("CONSUME")).toBe(false);
  });

  it("rejects WASTE without a reason", () => {
    expect(rejection({ type: "WASTE", quantity: 1, currentBalance: 5 })).toMatchObject({
      kind: "REASON_REQUIRED",
      type: "WASTE",
    });
  });

  it("rejects a whitespace-only reason", () => {
    expect(rejection({ type: "ADJUST", quantity: 1, currentBalance: 5, reason: "   " })).toMatchObject({
      kind: "REASON_REQUIRED",
    });
  });
});

describe("non-negative stock (BR-10)", () => {
  it("refuses to drive the balance below zero", () => {
    expect(rejection({ type: "CONSUME", quantity: 5, currentBalance: 3 })).toEqual({
      kind: "INSUFFICIENT_STOCK",
      available: 3,
      requested: 5,
      shortfall: 2,
    });
  });

  it("allows consuming exactly the whole balance", () => {
    expect(plan({ type: "CONSUME", quantity: 3, currentBalance: 3 }).balanceAfter).toBe(0);
  });

  it("permits an authorised override and records it", () => {
    const result = plan({ type: "CONSUME", quantity: 5, currentBalance: 3, allowNegative: true });
    expect(result.balanceAfter).toBe(-2);
    expect(result.negativeOverride).toBe(true);
  });

  it("does not mark an ordinary movement as an override", () => {
    expect(plan({ type: "RECEIVE", quantity: 1, currentBalance: 0 }).negativeOverride).toBe(false);
  });
});

describe("decimal handling", () => {
  it("rounds to the 3 places the column stores", () => {
    const result = plan({ type: "CONSUME", quantity: 0.1 + 0.2, currentBalance: 1 });
    expect(result.balanceAfter).toBe(0.7);
  });
});

describe("par level status (BR-8)", () => {
  it.each([
    [0, 5, "out-of-stock"],
    [2, 5, "below-par"],
    [5, 5, "ok"],
    [8, 5, "ok"],
    [1, 0, "ok"],
  ] as const)("stock %d against par %d is %s", (quantity, par, expected) => {
    expect(parStatus(quantity, par)).toBe(expected);
  });

  it("treats out-of-stock and below-par as needing a reorder", () => {
    expect(isBelowPar(0, 5)).toBe(true);
    expect(isBelowPar(2, 5)).toBe(true);
    expect(isBelowPar(5, 5)).toBe(false);
  });

  it("computes the quantity that returns stock to par", () => {
    expect(reorderQuantity(2, 5)).toBe(3);
    expect(reorderQuantity(7, 5)).toBe(0);
  });
});
