import { describe, expect, it } from "vitest";
import {
  buildCycleDays,
  canTransitionCycle,
  describePublishProblem,
  isDeletable,
  isSlotCompatible,
  isStructurallyEditable,
  phaseForWeek,
  validatePublish,
  weekCountFor,
  weekForDay,
  type DaySummary,
} from "@/modules/cycles/domain/cycle";

// BR-4, BR-5

describe("calendar shape", () => {
  it("maps days onto weeks in blocks of seven", () => {
    expect(weekForDay(1)).toBe(1);
    expect(weekForDay(7)).toBe(1);
    expect(weekForDay(8)).toBe(2);
    expect(weekForDay(28)).toBe(4);
  });

  it("labels the four cycle phases", () => {
    expect(phaseForWeek(1)).toBe("Establish");
    expect(phaseForWeek(2)).toBe("Expand");
    expect(phaseForWeek(3)).toBe("Refine");
    expect(phaseForWeek(4)).toBe("Peak");
  });

  it("repeats the final phase for longer cycles", () => {
    expect(phaseForWeek(5)).toBe("Peak");
    expect(phaseForWeek(9)).toBe("Peak");
  });

  it("counts partial weeks", () => {
    expect(weekCountFor(28)).toBe(4);
    expect(weekCountFor(30)).toBe(5);
    expect(weekCountFor(1)).toBe(1);
  });

  it("builds a full set of numbered days", () => {
    const days = buildCycleDays(28);
    expect(days).toHaveLength(28);
    expect(days[0]).toEqual({ dayNumber: 1, weekNumber: 1, phaseLabel: "Establish" });
    expect(days[27]).toEqual({ dayNumber: 28, weekNumber: 4, phaseLabel: "Peak" });
  });
});

describe("cycle lifecycle", () => {
  it("allows draft to activate and active to close", () => {
    expect(canTransitionCycle("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransitionCycle("ACTIVE", "CLOSED")).toBe(true);
    expect(canTransitionCycle("CLOSED", "ARCHIVED")).toBe(true);
  });

  it("refuses to reopen a published cycle", () => {
    expect(canTransitionCycle("ACTIVE", "DRAFT")).toBe(false);
    expect(canTransitionCycle("ARCHIVED", "ACTIVE")).toBe(false);
  });

  it("restricts structural edits and deletion to drafts", () => {
    expect(isStructurallyEditable("DRAFT")).toBe(true);
    expect(isStructurallyEditable("ACTIVE")).toBe(false);
    expect(isDeletable("DRAFT")).toBe(true);
    expect(isDeletable("ACTIVE")).toBe(false);
  });
});

describe("validatePublish (BR-4)", () => {
  const fullDay = (dayNumber: number): DaySummary => ({
    dayNumber,
    assignments: (["BF", "SN", "LU", "DI"] as const).map((mealType) => ({
      mealType,
      recipeVersionStatus: "PUBLISHED",
      recipeActive: true,
    })),
  });

  it("accepts a cycle with every slot filled by a published recipe", () => {
    const result = validatePublish([fullDay(1), fullDay(2)]);
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("reports which meals a day is missing", () => {
    const result = validatePublish([
      { dayNumber: 3, assignments: [{ mealType: "BF", recipeVersionStatus: "PUBLISHED", recipeActive: true }] },
    ]);
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toEqual({ kind: "MISSING_MEALS", dayNumber: 3, missing: ["SN", "LU", "DI"] });
    expect(result.incompleteDayNumbers).toEqual([3]);
  });

  // The prototype only counted assignments; a draft recipe passed validation.
  it("rejects a slot filled with an unpublished recipe version", () => {
    const day = fullDay(1);
    day.assignments[2].recipeVersionStatus = "DRAFT";
    const result = validatePublish([day]);
    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual({ kind: "UNPUBLISHED_RECIPE", dayNumber: 1, mealType: "LU" });
  });

  it("rejects a slot filled with an archived recipe", () => {
    const day = fullDay(1);
    day.assignments[0].recipeActive = false;
    const result = validatePublish([day]);
    expect(result.problems).toContainEqual({ kind: "INACTIVE_RECIPE", dayNumber: 1, mealType: "BF" });
  });

  it("lists every offending day, deduplicated and sorted", () => {
    const result = validatePublish([
      { dayNumber: 5, assignments: [] },
      { dayNumber: 2, assignments: [] },
    ]);
    expect(result.incompleteDayNumbers).toEqual([2, 5]);
  });

  it("describes problems in language the chef can act on", () => {
    expect(describePublishProblem({ kind: "MISSING_MEALS", dayNumber: 3, missing: ["LU", "DI"] })).toBe(
      "Day 3 is missing Lunch, Dinner.",
    );
    expect(describePublishProblem({ kind: "UNPUBLISHED_RECIPE", dayNumber: 1, mealType: "BF" })).toContain(
      "not published",
    );
  });
});

describe("isSlotCompatible (BR-5)", () => {
  it("permits a recipe only in its own meal slot", () => {
    expect(isSlotCompatible("LU", "LU")).toBe(true);
    expect(isSlotCompatible("BF", "LU")).toBe(false);
  });
});
