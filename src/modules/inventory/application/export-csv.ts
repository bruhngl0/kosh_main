import { listIngredients } from "@/modules/inventory/application/ingredient-management";

/**
 * Inventory CSV export.
 *
 * Restores the full column set from Kosh_Inventory.html:1042 — the React
 * rewrite had dropped vendor, quantity needed, unit cost, total, status, and
 * notes, which are most of the reason anyone exports it.
 */

const COLUMNS = [
  "Ingredient",
  "Category",
  "Frequency",
  "Vendor",
  "Qty Needed",
  "Unit",
  "Unit Cost",
  "Total Cost",
  "Status",
  "Par Level",
  "Current Stock",
  "Stock Status",
  "Notes",
] as const;

export async function buildInventoryCsv(filter: { managedOnly?: boolean } = { managedOnly: true }) {
  const items = await listIngredients(filter);

  const rows = items.map((item) => [
    item.name,
    item.category,
    item.defaultFrequency,
    item.vendor?.name ?? "",
    item.quantityNeeded,
    item.defaultUnit,
    item.unitCost ?? "",
    item.standingLineCost === null ? "" : Math.round(item.standingLineCost),
    item.inventoryStatus,
    item.parLevel,
    item.quantity,
    item.parStatus,
    item.notes ?? "",
  ]);

  return [COLUMNS, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/**
 * RFC 4180 quoting. Every cell is quoted so that commas, quotes, and the
 * newlines that appear in chef notes cannot break the row structure.
 */
function escapeCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
