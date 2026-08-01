import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canTransition,
  isRegenerable,
  isTerminal,
  planReceipt,
  type OrderLineState,
} from "@/modules/procurement/domain/lifecycle";

// BR-12, BR-13, BR-16

describe("status transitions (BR-12)", () => {
  it("allows the forward path", () => {
    expect(canTransition("DRAFT", "OUTREACH_READY")).toBe(true);
    expect(canTransition("OUTREACH_READY", "ORDERED")).toBe(true);
    expect(canTransition("ORDERED", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransition("PARTIALLY_RECEIVED", "RECEIVED")).toBe(true);
  });

  it("allows cancelling from any non-terminal state", () => {
    for (const status of ["DRAFT", "OUTREACH_READY", "ORDERED", "PARTIALLY_RECEIVED"] as const) {
      expect(canTransition(status, "CANCELLED")).toBe(true);
    }
  });

  // The prototype allowed any status to be set from any other.
  it("refuses to reopen a terminal order", () => {
    expect(canTransition("RECEIVED", "DRAFT")).toBe(false);
    expect(canTransition("RECEIVED", "ORDERED")).toBe(false);
    expect(canTransition("CANCELLED", "DRAFT")).toBe(false);
    expect(isTerminal("RECEIVED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
  });

  it("refuses to skip straight from draft to received", () => {
    expect(canTransition("DRAFT", "RECEIVED")).toBe(false);
    expect(canTransition("DRAFT", "PARTIALLY_RECEIVED")).toBe(false);
  });

  it("exposes the allowed set for error messages", () => {
    expect(allowedTransitions("ORDERED")).toEqual(["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]);
    expect(allowedTransitions("RECEIVED")).toEqual([]);
  });
});

describe("regeneration guard (BR-16)", () => {
  it("only rewrites orders that have not been sent", () => {
    expect(isRegenerable("DRAFT")).toBe(true);
    expect(isRegenerable("OUTREACH_READY")).toBe(true);
    expect(isRegenerable("ORDERED")).toBe(false);
    expect(isRegenerable("RECEIVED")).toBe(false);
  });
});

describe("planReceipt (BR-13)", () => {
  const lines: OrderLineState[] = [
    { lineId: "l1", ingredientId: "a", requestedQty: 10, receivedQty: 0, unit: "kg" },
    { lineId: "l2", ingredientId: "b", requestedQty: 5, receivedQty: 0, unit: "kg" },
  ];

  const planOf = (...args: Parameters<typeof planReceipt>) => {
    const outcome = planReceipt(...args);
    if (!outcome.ok) throw new Error(`expected success, got ${outcome.rejection.kind}`);
    return outcome.plan;
  };

  it("marks the order fully received when every line is complete", () => {
    const plan = planOf(lines, [
      { lineId: "l1", ingredientId: "a", receivedQty: 10 },
      { lineId: "l2", ingredientId: "b", receivedQty: 5 },
    ]);
    expect(plan.fullyReceived).toBe(true);
    expect(plan.nextStatus).toBe("RECEIVED");
  });

  it("leaves the order partially received when a line is short", () => {
    const plan = planOf(lines, [{ lineId: "l1", ingredientId: "a", receivedQty: 4 }]);
    expect(plan.fullyReceived).toBe(false);
    expect(plan.nextStatus).toBe("PARTIALLY_RECEIVED");
    expect(plan.lines.find((line) => line.lineId === "l1")?.outstandingQty).toBe(6);
    expect(plan.lines.find((line) => line.lineId === "l2")?.outstandingQty).toBe(5);
  });

  it("accumulates across successive receipts", () => {
    const partiallyReceived: OrderLineState[] = [
      { lineId: "l1", ingredientId: "a", requestedQty: 10, receivedQty: 4, unit: "kg" },
    ];
    const plan = planOf(partiallyReceived, [{ lineId: "l1", ingredientId: "a", receivedQty: 6 }]);
    expect(plan.lines[0].totalReceivedQty).toBe(10);
    expect(plan.fullyReceived).toBe(true);
  });

  it("accepts over-delivery rather than refusing the stock", () => {
    const plan = planOf(lines, [
      { lineId: "l1", ingredientId: "a", receivedQty: 12 },
      { lineId: "l2", ingredientId: "b", receivedQty: 5 },
    ]);
    expect(plan.lines[0].totalReceivedQty).toBe(12);
    expect(plan.lines[0].outstandingQty).toBe(0);
    expect(plan.fullyReceived).toBe(true);
  });

  it("records which quantity this receipt applied, separate from the total", () => {
    const partiallyReceived: OrderLineState[] = [
      { lineId: "l1", ingredientId: "a", requestedQty: 10, receivedQty: 4, unit: "kg" },
    ];
    const plan = planOf(partiallyReceived, [{ lineId: "l1", ingredientId: "a", receivedQty: 3 }]);
    expect(plan.lines[0].appliedQty).toBe(3);
    expect(plan.lines[0].totalReceivedQty).toBe(7);
  });

  it("rejects a line that does not belong to the order", () => {
    const outcome = planReceipt(lines, [{ lineId: "nope", ingredientId: "x", receivedQty: 1 }]);
    expect(outcome).toEqual({ ok: false, rejection: { kind: "UNKNOWN_LINE", lineId: "nope" } });
  });

  it("rejects a negative quantity", () => {
    const outcome = planReceipt(lines, [{ lineId: "l1", ingredientId: "a", receivedQty: -1 }]);
    expect(outcome).toEqual({ ok: false, rejection: { kind: "NEGATIVE_QUANTITY", lineId: "l1" } });
  });

  it("rejects a receipt that receives nothing", () => {
    const outcome = planReceipt(lines, [{ lineId: "l1", ingredientId: "a", receivedQty: 0 }]);
    expect(outcome).toEqual({ ok: false, rejection: { kind: "NOTHING_RECEIVED" } });
  });
});
