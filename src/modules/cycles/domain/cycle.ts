/**
 * BR-4, BR-5 and cycle lifecycle rules.
 *
 * Pure: no I/O.
 */

export type CycleStatus = "DRAFT" | "ACTIVE" | "CLOSED" | "ARCHIVED";
export type MealType = "BF" | "SN" | "LU" | "DI";

export const MEAL_ORDER: readonly MealType[] = ["BF", "SN", "LU", "DI"];

export const MEAL_NAMES: Record<MealType, string> = {
  BF: "Breakfast",
  SN: "Snack",
  LU: "Lunch",
  DI: "Dinner",
};

/** Phase labels repeat the last value for cycles longer than four weeks. */
export const PHASE_LABELS = ["Establish", "Expand", "Refine", "Peak"] as const;

export const phaseForWeek = (weekNumber: number) =>
  PHASE_LABELS[Math.min(Math.max(weekNumber, 1) - 1, PHASE_LABELS.length - 1)];

export const weekForDay = (dayNumber: number) => Math.floor((dayNumber - 1) / 7) + 1;

export const weekCountFor = (durationDays: number) => Math.max(1, Math.ceil(durationDays / 7));

/** The day rows a new cycle starts life with. */
export function buildCycleDays(durationDays: number) {
  return Array.from({ length: durationDays }, (_, index) => {
    const dayNumber = index + 1;
    const weekNumber = weekForDay(dayNumber);
    return { dayNumber, weekNumber, phaseLabel: phaseForWeek(weekNumber) };
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

const TRANSITIONS: Record<CycleStatus, readonly CycleStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const allowedCycleTransitions = (from: CycleStatus) => TRANSITIONS[from];
export const canTransitionCycle = (from: CycleStatus, to: CycleStatus) => TRANSITIONS[from].includes(to);

/** Structural edits — days, assignments, deletion — are draft-only. */
export const isStructurallyEditable = (status: CycleStatus) => status === "DRAFT";
export const isDeletable = (status: CycleStatus) => status === "DRAFT";

// ── BR-4, publish validation ─────────────────────────────────────────────────

export type AssignmentSummary = {
  mealType: MealType;
  recipeVersionStatus: string;
  recipeActive: boolean;
};

export type DaySummary = {
  dayNumber: number;
  assignments: AssignmentSummary[];
};

export type PublishProblem =
  | { kind: "MISSING_MEALS"; dayNumber: number; missing: MealType[] }
  | { kind: "UNPUBLISHED_RECIPE"; dayNumber: number; mealType: MealType }
  | { kind: "INACTIVE_RECIPE"; dayNumber: number; mealType: MealType };

export type PublishValidation = {
  valid: boolean;
  problems: PublishProblem[];
  /** Convenience for the UI, which lists the offending days. */
  incompleteDayNumbers: number[];
};

/**
 * A cycle may activate only when every day has all four slots filled with a
 * published version of an active recipe.
 */
export function validatePublish(days: DaySummary[]): PublishValidation {
  const problems: PublishProblem[] = [];

  for (const day of days) {
    const present = new Set(day.assignments.map((assignment) => assignment.mealType));
    const missing = MEAL_ORDER.filter((meal) => !present.has(meal));
    if (missing.length) {
      problems.push({ kind: "MISSING_MEALS", dayNumber: day.dayNumber, missing });
    }

    for (const assignment of day.assignments) {
      if (!assignment.recipeActive) {
        problems.push({ kind: "INACTIVE_RECIPE", dayNumber: day.dayNumber, mealType: assignment.mealType });
      } else if (assignment.recipeVersionStatus !== "PUBLISHED") {
        problems.push({ kind: "UNPUBLISHED_RECIPE", dayNumber: day.dayNumber, mealType: assignment.mealType });
      }
    }
  }

  return {
    valid: problems.length === 0,
    problems,
    incompleteDayNumbers: [...new Set(problems.map((problem) => problem.dayNumber))].sort((a, b) => a - b),
  };
}

export function describePublishProblem(problem: PublishProblem): string {
  switch (problem.kind) {
    case "MISSING_MEALS":
      return `Day ${problem.dayNumber} is missing ${problem.missing.map((meal) => MEAL_NAMES[meal]).join(", ")}.`;
    case "UNPUBLISHED_RECIPE":
      return `Day ${problem.dayNumber} ${MEAL_NAMES[problem.mealType]} uses a recipe version that is not published.`;
    case "INACTIVE_RECIPE":
      return `Day ${problem.dayNumber} ${MEAL_NAMES[problem.mealType]} uses an archived recipe.`;
  }
}

// ── BR-5, slot compatibility ─────────────────────────────────────────────────

export const isSlotCompatible = (slot: MealType, recipeMealType: MealType) => slot === recipeMealType;
