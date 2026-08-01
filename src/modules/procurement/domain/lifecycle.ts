/**
 * BR-12 and BR-13 — purchase order lifecycle and receiving.
 *
 * The prototype allowed any status to be set from any other, and marking an
 * order RECEIVED changed no stock at all. Both are fixed here.
 *
 * Pure: no I/O.
 */

import { round } from "@/shared/units";

export type PurchaseOrderStatus =
  | "DRAFT"
  | "OUTREACH_READY"
  | "ORDERED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

/** BR-12. RECEIVED and CANCELLED are terminal. */
const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ["OUTREACH_READY", "ORDERED", "CANCELLED"],
  OUTREACH_READY: ["DRAFT", "ORDERED", "CANCELLED"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export const allowedTransitions = (from: PurchaseOrderStatus) => TRANSITIONS[from];

export const canTransition = (from: PurchaseOrderStatus, to: PurchaseOrderStatus) =>
  TRANSITIONS[from].includes(to);

export const isTerminal = (status: PurchaseOrderStatus) => TRANSITIONS[status].length === 0;

/** An order that has left DRAFT must not be silently rewritten by regeneration (BR-16). */
export const isRegenerable = (status: PurchaseOrderStatus) =>
  status === "DRAFT" || status === "OUTREACH_READY";

// ── Receiving ────────────────────────────────────────────────────────────────

export type ReceiptLine = {
  lineId: string;
  ingredientId: string;
  /** Quantity being received now, in the line's purchase unit. */
  receivedQty: number;
};

export type OrderLineState = {
  lineId: string;
  ingredientId: string;
  requestedQty: number;
  /** Already received before this receipt. */
  receivedQty: number;
  unit: string;
};

export type ReceiptPlanLine = {
  lineId: string;
  ingredientId: string;
  unit: string;
  /** Quantity applied by this receipt. */
  appliedQty: number;
  /** Cumulative received after this receipt. */
  totalReceivedQty: number;
  outstandingQty: number;
};

export type ReceiptPlan = {
  lines: ReceiptPlanLine[];
  /** Status the order should move to once this receipt is applied. */
  nextStatus: Extract<PurchaseOrderStatus, "PARTIALLY_RECEIVED" | "RECEIVED">;
  fullyReceived: boolean;
};

export type ReceiptRejection =
  | { kind: "UNKNOWN_LINE"; lineId: string }
  | { kind: "NEGATIVE_QUANTITY"; lineId: string }
  | { kind: "NOTHING_RECEIVED" };

export type ReceiptOutcome =
  | { ok: true; plan: ReceiptPlan }
  | { ok: false; rejection: ReceiptRejection };

/**
 * Works out what a receipt does to each order line and what the order's status
 * becomes. Over-receiving is permitted — vendors deliver more than asked for and
 * refusing the stock would be worse than recording it — but under-receiving
 * leaves the order PARTIALLY_RECEIVED so the shortfall stays visible.
 */
export function planReceipt(lines: OrderLineState[], receipts: ReceiptLine[]): ReceiptOutcome {
  const byId = new Map(lines.map((line) => [line.lineId, line]));
  const applied = new Map<string, number>();

  for (const receipt of receipts) {
    const line = byId.get(receipt.lineId);
    if (!line) return { ok: false, rejection: { kind: "UNKNOWN_LINE", lineId: receipt.lineId } };
    if (!Number.isFinite(receipt.receivedQty) || receipt.receivedQty < 0) {
      return { ok: false, rejection: { kind: "NEGATIVE_QUANTITY", lineId: receipt.lineId } };
    }
    applied.set(receipt.lineId, round((applied.get(receipt.lineId) ?? 0) + receipt.receivedQty));
  }

  const total = [...applied.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { ok: false, rejection: { kind: "NOTHING_RECEIVED" } };

  const planLines: ReceiptPlanLine[] = lines.map((line) => {
    const appliedQty = applied.get(line.lineId) ?? 0;
    const totalReceivedQty = round(line.receivedQty + appliedQty);
    return {
      lineId: line.lineId,
      ingredientId: line.ingredientId,
      unit: line.unit,
      appliedQty,
      totalReceivedQty,
      outstandingQty: round(Math.max(0, line.requestedQty - totalReceivedQty)),
    };
  });

  const fullyReceived = planLines.every((line) => line.outstandingQty <= 0);

  return {
    ok: true,
    plan: {
      lines: planLines,
      nextStatus: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
      fullyReceived,
    },
  };
}
