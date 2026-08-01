/** Production module — public surface. See docs/system-design.md §4.3. */

export {
  generatePrepTasks,
  updatePrepTask,
  listPrepTasks,
} from "@/modules/production/application/prep-tasks";

export { consumeProduction } from "@/modules/production/application/consume-production";

export {
  classifyPrepLead,
  isUrgentPrep,
  prepDueDate,
  serviceDateFor,
  derivePrepTasks,
  LEAD_LABEL,
  LEAD_OFFSET_DAYS,
  type PrepLeadType,
  type DerivedPrepTask,
} from "@/modules/production/domain/prep-lead-time";
