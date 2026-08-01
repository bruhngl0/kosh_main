/**
 * BR-9, BR-10, BR-11 — inventory movement rules.
 *
 * The prototype let a caller supply a signed delta, which meant a CONSUME with
 * a positive number silently increased stock. Direction is a property of the
 * movement type, never of the caller's input: callers supply a magnitude.
 *
 * Pure: no I/O.
 */

import { round } from "@/shared/units";

export type MovementType = "RECEIVE" | "CONSUME" | "ADJUST" | "WASTE" | "RETURN";

type MovementRule = {
  /** How the magnitude affects the balance. `SET` replaces it outright. */
  direction: "INCREASE" | "DECREASE" | "SET";
  requiresReason: boolean;
};

export const MOVEMENT_RULES: Record<MovementType, MovementRule> = {
  RECEIVE: { direction: "INCREASE", requiresReason: false },
  RETURN: { direction: "INCREASE", requiresReason: false },
  CONSUME: { direction: "DECREASE", requiresReason: false },
  WASTE: { direction: "DECREASE", requiresReason: true },
  ADJUST: { direction: "SET", requiresReason: true },
};

export const requiresReason = (type: MovementType) => MOVEMENT_RULES[type].requiresReason;

export type MovementRequest = {
  type: MovementType;
  /** Always non-negative. For ADJUST this is the counted balance. */
  quantity: number;
  currentBalance: number;
  reason?: string | null;
  /** BR-10 — an authorised actor may push the balance below zero. */
  allowNegative?: boolean;
};

export type MovementPlan = {
  /** Signed value to apply to the balance. */
  quantityDelta: number;
  balanceAfter: number;
  negativeOverride: boolean;
};

export type MovementRejection =
  | { kind: "NEGATIVE_QUANTITY" }
  | { kind: "REASON_REQUIRED"; type: MovementType }
  | { kind: "INSUFFICIENT_STOCK"; available: number; requested: number; shortfall: number };

export type MovementOutcome =
  | { ok: true; plan: MovementPlan }
  | { ok: false; rejection: MovementRejection };

/**
 * Computes the balance effect of a movement, or the reason it is refused.
 *
 * Returns a result rather than throwing so the caller decides how to surface
 * the failure — the HTTP layer maps it to a code, tests assert on it directly.
 */
export function planMovement(request: MovementRequest): MovementOutcome {
  const rule = MOVEMENT_RULES[request.type];
  const quantity = round(request.quantity);

  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, rejection: { kind: "NEGATIVE_QUANTITY" } };
  }

  if (rule.requiresReason && !request.reason?.trim()) {
    return { ok: false, rejection: { kind: "REASON_REQUIRED", type: request.type } };
  }

  const current = round(request.currentBalance);
  const balanceAfter =
    rule.direction === "INCREASE"
      ? round(current + quantity)
      : rule.direction === "DECREASE"
        ? round(current - quantity)
        : quantity;

  if (balanceAfter < 0 && !request.allowNegative) {
    return {
      ok: false,
      rejection: {
        kind: "INSUFFICIENT_STOCK",
        available: current,
        requested: quantity,
        shortfall: round(quantity - current),
      },
    };
  }

  return {
    ok: true,
    plan: {
      quantityDelta: round(balanceAfter - current),
      balanceAfter,
      negativeOverride: balanceAfter < 0,
    },
  };
}

// ── BR-8, par-level status ───────────────────────────────────────────────────

export type ParStatus = "out-of-stock" | "below-par" | "ok";

export function parStatus(quantity: number, parLevel: number): ParStatus {
  if (quantity <= 0) return "out-of-stock";
  if (quantity < parLevel) return "below-par";
  return "ok";
}

export const isBelowPar = (quantity: number, parLevel: number) => parStatus(quantity, parLevel) !== "ok";

/** How much to order to return to par. Zero when at or above par. */
export const reorderQuantity = (quantity: number, parLevel: number) =>
  round(Math.max(0, parLevel - quantity));
