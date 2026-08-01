/**
 * BR-6 and BR-7 — demand aggregation and purchase quantities.
 *
 * This is where the prototype's most consequential bug lived: recipe demand in
 * grams was compared against stock in kilograms and emitted in the vendor's
 * unit, with no conversion anywhere. See docs/system-design.md §6.
 *
 * Pure: no I/O.
 */

import { convert, round } from "@/shared/units";

export type DemandLine = {
  ingredientId: string;
  ingredientName: string;
  /** Quantity for ONE serving, in the unit the recipe was authored in. */
  quantity: number;
  unit: string;
  servings: number;
};

export type IngredientContext = {
  ingredientId: string;
  ingredientName: string;
  /** The ingredient's stock unit. Balances are always expressed in it (§6.2). */
  stockUnit: string;
  stockOnHand: number;
  preferredVendorId: string | null;
  preferredVendorName: string | null;
  /** Vendor's purchase unit, if it differs from the stock unit. */
  purchaseUnit: string | null;
  unitCost: number | null;
};

/** A line we refuse to guess at, surfaced for a human to resolve (§6.2). */
export type UnitException = {
  ingredientId: string;
  ingredientName: string;
  from: string;
  to: string;
  quantity: number;
};

export type AggregatedDemand = {
  ingredientId: string;
  ingredientName: string;
  /** Total demand expressed in the ingredient's stock unit. */
  quantity: number;
  unit: string;
};

export type DemandResult = {
  demand: AggregatedDemand[];
  exceptions: UnitException[];
};

/**
 * Aggregates per-serving recipe lines into total demand per ingredient,
 * converting every line into that ingredient's stock unit.
 *
 * A line whose unit cannot be converted is NOT dropped and NOT summed blindly —
 * it comes back as an exception naming both units.
 */
export function aggregateDemand(
  lines: DemandLine[],
  contexts: Map<string, IngredientContext>,
): DemandResult {
  const totals = new Map<string, AggregatedDemand>();
  // Keyed so one badly-defined ingredient reports once with its total, rather
  // than once per day it appears on the menu.
  const exceptionsByKey = new Map<string, UnitException>();

  for (const line of lines) {
    const context = contexts.get(line.ingredientId);
    if (!context) continue;

    const required = line.quantity * line.servings;
    const converted = convert(required, line.unit, context.stockUnit);

    if (converted === null) {
      const key = `${line.ingredientId}:${line.unit}`;
      const existing = exceptionsByKey.get(key);
      if (existing) {
        existing.quantity = round(existing.quantity + required);
      } else {
        exceptionsByKey.set(key, {
          ingredientId: line.ingredientId,
          ingredientName: context.ingredientName,
          from: line.unit,
          to: context.stockUnit,
          quantity: round(required),
        });
      }
      continue;
    }

    const existing = totals.get(line.ingredientId);
    if (existing) {
      existing.quantity = round(existing.quantity + converted);
    } else {
      totals.set(line.ingredientId, {
        ingredientId: line.ingredientId,
        ingredientName: context.ingredientName,
        quantity: round(converted),
        unit: context.stockUnit,
      });
    }
  }

  return {
    demand: [...totals.values()].sort((a, b) => a.ingredientName.localeCompare(b.ingredientName)),
    exceptions: [...exceptionsByKey.values()].sort((a, b) => a.ingredientName.localeCompare(b.ingredientName)),
  };
}

// ── BR-7, purchase requirement ───────────────────────────────────────────────

export type PurchaseLine = {
  ingredientId: string;
  ingredientName: string;
  /** Quantity to order, in the vendor's purchase unit. */
  requestedQty: number;
  unit: string;
  unitCost: number | null;
  lineCost: number | null;
  /** The same requirement expressed in stock units, for traceability. */
  requiredInStockUnit: number;
  stockUnit: string;
};

export type VendorGroup = {
  vendorId: string;
  vendorName: string;
  lines: PurchaseLine[];
  estimatedCost: number;
};

export type PurchasePlan = {
  groups: VendorGroup[];
  /** Demanded, short on stock, but with no preferred vendor to buy from. */
  unsourced: PurchaseLine[];
  exceptions: UnitException[];
  /** Demanded but already fully covered by stock. */
  covered: AggregatedDemand[];
};

/**
 * Turns aggregated demand into vendor-grouped purchase lines.
 *
 * quantity to order = max(0, demand − stock on hand), then converted into the
 * vendor's purchase unit. Ingredients with a real requirement but no preferred
 * vendor are returned in `unsourced` rather than silently dropped, which is what
 * the prototype did.
 */
export function buildPurchasePlan(
  demand: AggregatedDemand[],
  contexts: Map<string, IngredientContext>,
): PurchasePlan {
  const groups = new Map<string, VendorGroup>();
  const unsourced: PurchaseLine[] = [];
  const exceptions: UnitException[] = [];
  const covered: AggregatedDemand[] = [];

  for (const item of demand) {
    const context = contexts.get(item.ingredientId);
    if (!context) continue;

    const shortfall = round(Math.max(0, item.quantity - context.stockOnHand));
    if (shortfall <= 0) {
      covered.push(item);
      continue;
    }

    // Order in the vendor's unit when they price in one; otherwise stock units.
    const purchaseUnit = context.purchaseUnit ?? context.stockUnit;
    const requestedQty = convert(shortfall, context.stockUnit, purchaseUnit);

    if (requestedQty === null) {
      exceptions.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        from: context.stockUnit,
        to: purchaseUnit,
        quantity: shortfall,
      });
      continue;
    }

    const line: PurchaseLine = {
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      requestedQty,
      unit: purchaseUnit,
      unitCost: context.unitCost,
      lineCost: context.unitCost === null ? null : round(requestedQty * context.unitCost, 2),
      requiredInStockUnit: shortfall,
      stockUnit: context.stockUnit,
    };

    if (!context.preferredVendorId) {
      unsourced.push(line);
      continue;
    }

    const group = groups.get(context.preferredVendorId) ?? {
      vendorId: context.preferredVendorId,
      vendorName: context.preferredVendorName ?? "Unknown vendor",
      lines: [],
      estimatedCost: 0,
    };
    group.lines.push(line);
    group.estimatedCost = round(group.estimatedCost + (line.lineCost ?? 0), 2);
    groups.set(context.preferredVendorId, group);
  }

  return {
    groups: [...groups.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
    unsourced: unsourced.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName)),
    exceptions,
    covered,
  };
}
