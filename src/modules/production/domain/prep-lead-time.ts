/**
 * BR-3 — advance-prep lead-time classification.
 * Ported from Kosh_Cycle_Planner.html:435.
 *
 * The chef writes prep requirements as prose ("Marinate salmon 24HR PRIOR",
 * "Ferment batter 18HR PRIOR", "Marinate cod 3 DAYS PRIOR"). The lead time is
 * embedded in that prose, and the kitchen depends on it being read correctly:
 * a 3-day marinade classified as same-day is a dish that cannot be served.
 *
 * Pure: no I/O.
 */

export type PrepLeadType = "SAME_DAY" | "DAY_BEFORE" | "H24" | "D3";

/** Days before the service date that work of each type must start. */
export const LEAD_OFFSET_DAYS: Record<PrepLeadType, number> = {
  SAME_DAY: 0,
  DAY_BEFORE: 1,
  H24: 1,
  D3: 3,
};

export const LEAD_LABEL: Record<PrepLeadType, string> = {
  SAME_DAY: "SAME DAY",
  DAY_BEFORE: "DAY BEFORE",
  H24: "24 HR",
  D3: "3 DAYS",
};

/**
 * Ordered most-urgent first: the first pattern that matches wins, so
 * "3 days" beats "overnight" in a note mentioning both.
 */
const LEAD_PATTERNS: { type: PrepLeadType; pattern: RegExp }[] = [
  { type: "D3", pattern: /\b3\s*days?\b/i },
  { type: "H24", pattern: /\b24\s*(hr|hrs|hour|hours)\b/i },
  { type: "DAY_BEFORE", pattern: /\b(overnight|18\s*(hr|hrs|hour|hours)|8\s*(hr|hrs|hour|hours)|6\s*(hr|hrs|hour|hours))\b/i },
];

const URGENT_PATTERN = /\b(prior|mandatory)\b/i;

/**
 * Phrases describing how long something KEEPS, not how far ahead it must start.
 *
 * "Pre-make basil oil (3 days shelf life)" is same-day work with a three-day
 * shelf life. The prototype matched a bare "3 days" anywhere in the string
 * (Kosh_Cycle_Planner.html:438) and scheduled the oil three days early — which
 * would put it at the very end of its life on the day it is served.
 */
const SHELF_LIFE_PATTERN = /\b(shelf[-\s]?life|keeps?|lasts?|good for|stays? fresh|stores?)\b/i;

/** Removes clauses that describe shelf life so they cannot be read as lead time. */
export function stripShelfLifeClauses(text: string): string {
  return text
    // Parentheticals: "(3 days shelf life)"
    .replace(/\([^)]*\)/g, (clause) => (SHELF_LIFE_PATTERN.test(clause) ? " " : clause))
    // Trailing dash clauses: "— keeps 4 days". Whitespace before the dash is
    // required so hyphenated words like "Pre-make" are untouched.
    .replace(/\s+[—–-]\s*[^—–-]*$/, (clause) => (SHELF_LIFE_PATTERN.test(clause) ? " " : clause));
}

export function classifyPrepLead(text: string): PrepLeadType {
  const scheduled = stripShelfLifeClauses(text);
  for (const { type, pattern } of LEAD_PATTERNS) {
    if (pattern.test(scheduled)) return type;
  }
  return "SAME_DAY";
}

/**
 * Urgent when the text says so, or when the lead time alone makes it critical —
 * anything needing 24 hours or more cannot be recovered on the day.
 */
export function isUrgentPrep(text: string, leadType: PrepLeadType = classifyPrepLead(text)): boolean {
  return URGENT_PATTERN.test(text) || leadType === "H24" || leadType === "D3";
}

/**
 * Due date for a prep task, given the date the dish is served.
 * Returns null when the cycle has no start date, in which case the task is
 * still created but cannot be scheduled.
 */
export function prepDueDate(serviceDate: Date | null, leadType: PrepLeadType): Date | null {
  if (!serviceDate) return null;
  const due = new Date(serviceDate);
  due.setUTCDate(due.getUTCDate() - LEAD_OFFSET_DAYS[leadType]);
  return due;
}

/** Service date for a cycle day, given the cycle's start date. */
export function serviceDateFor(weekStart: Date | null, dayNumber: number): Date | null {
  if (!weekStart) return null;
  const date = new Date(weekStart);
  date.setUTCDate(date.getUTCDate() + (dayNumber - 1));
  return date;
}

// ── Task derivation ──────────────────────────────────────────────────────────

export type PrepSourceStep = {
  stepNumber: number;
  title: string;
  instructions: string;
  /** info | warning | mandatory. `info` steps are ordinary cooking, not prep. */
  criticality: string;
};

export type DerivedPrepTask = {
  /** Stable natural key for idempotent regeneration (BR-16). */
  sourceKey: string;
  cycleDayId: string;
  mealAssignmentId: string;
  taskText: string;
  taskType: PrepLeadType;
  dueDate: Date | null;
  urgent: boolean;
};

export type PrepDerivationInput = {
  cycleDayId: string;
  dayNumber: number;
  mealType: string;
  mealAssignmentId: string;
  steps: PrepSourceStep[];
  weekStart: Date | null;
};

/**
 * Derives the advance-prep tasks implied by one meal assignment.
 * Only non-`info` steps produce tasks — those are the ones the chef marked as
 * carrying a control or a lead time.
 */
export function derivePrepTasks(input: PrepDerivationInput): DerivedPrepTask[] {
  const serviceDate = serviceDateFor(input.weekStart, input.dayNumber);

  return input.steps
    .filter((step) => step.criticality !== "info")
    .map((step) => {
      const taskText = `${step.title}: ${step.instructions}`;
      const taskType = classifyPrepLead(taskText);
      return {
        sourceKey: `${input.cycleDayId}:${input.mealType}:${step.stepNumber}`,
        cycleDayId: input.cycleDayId,
        mealAssignmentId: input.mealAssignmentId,
        taskText,
        taskType,
        dueDate: prepDueDate(serviceDate, taskType),
        urgent: isUrgentPrep(taskText, taskType) || step.criticality === "mandatory",
      };
    });
}
