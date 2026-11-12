import { describe, expect, it } from "vitest";
import { allergenGroups, findClashes } from "@/modules/runsheet/domain/allergens";
import { CHECKLIST, STANDARD_TASK_IDS } from "@/modules/runsheet/domain/checklist";
import { cycleCovering, dayNumberOn } from "@/modules/cycles/domain/cycle";
import { deliversOn } from "@/modules/subscribers/domain/subscriber";
import { setCheckSchema, updateRunSheetSchema } from "@/shared/schemas/run-sheet";

// BR-26..BR-29

const cycle = (overrides: Partial<{ status: "DRAFT" | "ACTIVE" | "CLOSED" | "ARCHIVED"; cycleNumber: number; weekStart: Date | null; durationDays: number }> = {}) => ({
  status: "ACTIVE" as const,
  cycleNumber: 1,
  weekStart: new Date("2026-08-03T00:00:00Z"),
  durationDays: 28,
  ...overrides,
});

describe("BR-26 which cycle day a date is", () => {
  it("numbers the start date as day 1 and stops after the last day", () => {
    expect(dayNumberOn(cycle(), "2026-08-03")).toBe(1);
    expect(dayNumberOn(cycle(), "2026-08-30")).toBe(28);
    expect(dayNumberOn(cycle(), "2026-08-31")).toBeNull();
    expect(dayNumberOn(cycle(), "2026-08-02")).toBeNull();
    expect(dayNumberOn(cycle({ weekStart: null }), "2026-08-03")).toBeNull();
  });

  it("prefers the live cycle when cycles overlap, and never an archived one", () => {
    const draft = cycle({ status: "DRAFT", cycleNumber: 2, weekStart: new Date("2026-08-24T00:00:00Z") });
    const active = cycle({ cycleNumber: 1 });
    expect(cycleCovering([draft, active], "2026-08-25")?.cycle).toBe(active);
    expect(cycleCovering([draft, active], "2026-09-02")).toMatchObject({ cycle: draft, dayNumber: 10 });
    expect(cycleCovering([cycle({ status: "ARCHIVED" })], "2026-08-05")).toBeNull();
  });

  it("delivers to active subscribers whose start date has arrived", () => {
    expect(deliversOn({ status: "active", startDate: null }, "2026-08-05")).toBe(true);
    expect(deliversOn({ status: "active", startDate: new Date("2026-08-05T00:00:00Z") }, "2026-08-05")).toBe(true);
    expect(deliversOn({ status: "active", startDate: new Date("2026-08-06T00:00:00Z") }, "2026-08-05")).toBe(false);
    expect(deliversOn({ status: "onboarding", startDate: null }, "2026-08-05")).toBe(false);
    expect(deliversOn({ status: "paused", startDate: null }, "2026-08-05")).toBe(false);
  });
});

describe("BR-27 standard checklist", () => {
  it("has unique task ids, so a stored tick can only mean one task", () => {
    const ids = CHECKLIST.flatMap((phase) => phase.tasks.map((task) => task.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(STANDARD_TASK_IDS.size).toBe(ids.length);
  });

  it("accepts one tick or tick-all, nothing else", () => {
    expect(setCheckSchema.safeParse({ taskKey: "p1", done: true }).success).toBe(true);
    expect(setCheckSchema.safeParse({ all: true }).success).toBe(true);
    expect(setCheckSchema.safeParse({ all: false }).success).toBe(false);
    expect(updateRunSheetSchema.safeParse({}).success).toBe(false);
    expect(updateRunSheetSchema.parse({ chefName: "  " })).toEqual({ chefName: null });
  });
});

describe("BR-29 allergen matching", () => {
  it("reads the kitchen's codes, ignoring the parenthetical detail", () => {
    expect(allergenGroups("Gluten (roti)")).toEqual(["Gluten"]);
    expect(allergenGroups("Crustacean (paste)")).toEqual(["Crustacean"]);
    expect(allergenGroups("Tree nuts")).toEqual(["Tree nuts"]);
  });

  it("reads what subscribers type", () => {
    expect(allergenGroups("Peanuts")).toEqual(["Groundnuts"]);
    expect(allergenGroups("lactose intolerant")).toEqual(["Dairy"]);
    expect(allergenGroups("prawns")).toEqual(["Crustacean"]);
    expect(allergenGroups("Eggs")).toEqual(["Egg"]);
  });

  it("errs wide on ambiguous words", () => {
    expect(allergenGroups("nuts")).toEqual(["Tree nuts", "Groundnuts"]);
    expect(allergenGroups("shellfish")).toEqual(["Crustacean", "Mollusc"]);
    expect(allergenGroups("seafood")).toEqual(["Fish", "Crustacean", "Mollusc"]);
  });

  it("does not match short stems inside unrelated words", () => {
    expect(allergenGroups("eggplant")).toEqual([]);
    expect(allergenGroups("tilapia")).toEqual(["Fish"]);
  });

  it("flags clashes and reports allergies it cannot interpret instead of dropping them", () => {
    const dishes = [
      { mealType: "SN", title: "Trail mix", allergens: ["Tree nuts", "Sesame"] },
      { mealType: "DI", title: "Miso salmon", allergens: ["Fish", "Soya"] },
    ];
    const { clashes, unrecognised } = findClashes(["nuts", "kiwi"], dishes);
    expect(clashes).toEqual([{ mealType: "SN", dish: "Trail mix", allergy: "nuts", allergen: "Tree nuts" }]);
    expect(unrecognised).toEqual(["kiwi"]);
    expect(findClashes(["Dairy"], dishes)).toEqual({ clashes: [], unrecognised: [] });
  });
});
