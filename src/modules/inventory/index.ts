/** Inventory module — public surface. See docs/system-design.md §4.3. */

export {
  createIngredient,
  updateIngredient,
  archiveIngredient,
  listIngredients,
  getIngredient,
  getInventorySummary,
  // Cross-module query interface, consumed by procurement and production.
  getIngredientContexts,
  type IngredientView,
} from "@/modules/inventory/application/ingredient-management";

export {
  recordMovement,
  listMovements,
  // Reused by procurement receiving (BR-13) and production consumption (BR-14)
  // so stock rules exist in exactly one place. Prefer the batched form: it
  // costs the same few round trips for fifty ingredients as for one.
  applyMovement,
  applyMovements,
  type MovementRequest,
} from "@/modules/inventory/application/record-movement";

export {
  planMovement,
  parStatus,
  isBelowPar,
  reorderQuantity,
  requiresReason,
  MOVEMENT_RULES,
  type MovementType,
  type ParStatus,
} from "@/modules/inventory/domain/movements";

export { buildInventoryCsv } from "@/modules/inventory/application/export-csv";
