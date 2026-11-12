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
  syncCycleHeadcount,
  // Published for the subscribers module: roster changes re-run BR-30 in their own transaction.
  applyRosterHeadcount,
  type HeadcountResult,
} from "@/modules/cycles/application/headcount";

export {
  listCycles,
  getCycleCalendar,
  getConflicts,
  getProductionPlan,
  // Cross-module query interface, consumed by procurement and production.
  getWeekDemandInputs,
  getDayDemandInputs,
  // Published for the daily run sheet (BR-26).
  getMenuForDate,
  getCycleDateRanges,
  type CycleCalendar,
  type DayMenu,
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
  dayNumberOn,
  cycleCovering,
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
