import { describe, expect, it } from "vitest";
import {
  conflictedDayNumbers,
  findProteinConflicts,
  isExemptProtein,
  suggestSwap,
  type DinnerDay,
} from "@/modules/cycles/domain/protein-rotation";

// BR-1, BR-2

const day = (dayNumber: number, protein: string | null): DinnerDay => ({ dayNumber, protein });

describe("isExemptProtein", () => {
  it.each(["plant", "dairy", "legume", "  Plant  ", "DAIRY"])("exempts %s", (protein) => {
    expect(isExemptProtein(protein)).toBe(true);
  });

  it("does not exempt animal proteins", () => {
    expect(isExemptProtein("chicken")).toBe(false);
    expect(isExemptProtein("salmon")).toBe(false);
  });
});

describe("findProteinConflicts", () => {
  it("flags a repeat inside the window", () => {
    const conflicts = findProteinConflicts([day(1, "chicken"), day(3, "chicken")]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      dayNumber: 3,
      previousDayNumber: 1,
      protein: "chicken",
      gapDays: 2,
    });
  });

  it("allows a repeat exactly at the window boundary", () => {
    // Window of 4 means days 1 and 5 are fine — the gap is 4.
    expect(findProteinConflicts([day(1, "chicken"), day(5, "chicken")])).toHaveLength(0);
  });

  it("flags a repeat one day inside the boundary", () => {
    expect(findProteinConflicts([day(1, "chicken"), day(4, "chicken")])).toHaveLength(1);
  });

  it("honours a custom window", () => {
    expect(findProteinConflicts([day(1, "lamb"), day(5, "lamb")], 7)).toHaveLength(1);
    expect(findProteinConflicts([day(1, "lamb"), day(5, "lamb")], 2)).toHaveLength(0);
  });

  it("never flags exempt proteins", () => {
    expect(findProteinConflicts([day(1, "plant"), day(2, "plant"), day(3, "plant")])).toHaveLength(0);
    expect(findProteinConflicts([day(1, "dairy"), day(2, "dairy")])).toHaveLength(0);
  });

  it("ignores unassigned dinners", () => {
    expect(findProteinConflicts([day(1, "fish"), day(2, null), day(3, "fish")])).toHaveLength(1);
  });

  it("reports every colliding pair, not just the nearest", () => {
    const conflicts = findProteinConflicts([day(1, "prawn"), day(2, "prawn"), day(3, "prawn")]);
    expect(conflicts).toHaveLength(3); // 1-2, 1-3, 2-3
  });

  it("is case and whitespace insensitive", () => {
    expect(findProteinConflicts([day(1, " Chicken "), day(2, "chicken")])).toHaveLength(1);
  });

  // The prototype compared array positions, so a sparse cycle mis-detected.
  it("uses day numbers rather than array positions", () => {
    const sparse = [day(1, "beef"), day(20, "beef"), day(21, "beef")];
    const conflicts = findProteinConflicts(sparse);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ dayNumber: 21, previousDayNumber: 20 });
  });

  it("tolerates unsorted input", () => {
    expect(findProteinConflicts([day(3, "lamb"), day(1, "lamb")])).toHaveLength(1);
  });

  it("attaches a suggested swap", () => {
    const [conflict] = findProteinConflicts([day(1, "salmon"), day(2, "salmon")]);
    expect(conflict.suggestedSwap).toBe("chicken or plant");
  });
});

describe("suggestSwap", () => {
  it("maps known proteins", () => {
    expect(suggestSwap("chicken")).toBe("fish or lamb");
    expect(suggestSwap("prawn")).toBe("duck or beef");
  });

  it("falls back for unknown proteins", () => {
    expect(suggestSwap("ostrich")).toBe("a different protein category");
  });
});

describe("conflictedDayNumbers", () => {
  it("collapses conflicts to the days that carry them", () => {
    const conflicts = findProteinConflicts([day(1, "fish"), day(2, "fish"), day(3, "fish")]);
    expect([...conflictedDayNumbers(conflicts)].sort()).toEqual([2, 3]);
  });
});
