/**
 * Cycles module — public surface. See docs/system-design.md §4.3.
 *
 * Route handlers and other modules import from here and nowhere else inside
 * `modules/cycles`. Reaching for `infrastructure/` directly is a boundary
 * violation, not a shortcut.
 */

export {
  createCycle,
  updateCycle,
  publishCycle,
  deleteCycle,
} from "@/modules/cycles/application/cycle-management";

export { assignMeal, clearMeal } from "@/modules/cycles/application/meal-assignment";

export {
  listCycles,
  getCycleCalendar,
  getConflicts,
  getProductionPlan,
  // Cross-module query interface, consumed by procurement and production.
  getWeekDemandInputs,
  getDayDemandInputs,
  type CycleCalendar,
} from "@/modules/cycles/application/cycle-queries";

export {
  MEAL_ORDER,
  MEAL_NAMES,
  PHASE_LABELS,
  phaseForWeek,
  weekForDay,
  weekCountFor,
  buildCycleDays,
  validatePublish,
  describePublishProblem,
  isSlotCompatible,
  isStructurallyEditable,
  isDeletable,
  type MealType,
  type CycleStatus,
} from "@/modules/cycles/domain/cycle";

export {
  findProteinConflicts,
  conflictedDayNumbers,
  suggestSwap,
  isExemptProtein,
  DEFAULT_PROTEIN_WINDOW_DAYS,
  type ProteinConflict,
} from "@/modules/cycles/domain/protein-rotation";
