import { describe, expect, it } from "vitest";
import {
  canConvert,
  convert,
  formatQuantity,
  isOpaque,
  normaliseUnit,
  parseQuantity,
  resolveUnit,
  toBase,
} from "@/shared/units";

// docs/system-design.md §6

describe("normaliseUnit", () => {
  it("lowercases, trims, and strips trailing punctuation", () => {
    expect(normaliseUnit("  KG. ")).toBe("kg");
  });

  it("folds known opaque plurals onto a canonical code", () => {
    expect(normaliseUnit("leaves")).toBe("leaf");
    expect(normaliseUnit("bunches")).toBe("bunch");
  });
});

describe("resolveUnit", () => {
  it.each([
    ["kg", "kg", "MASS", 1000],
    ["gm", "g", "MASS", 1],
    ["grams", "g", "MASS", 1],
    ["L", "l", "VOLUME", 1000],
    ["tbsp", "tbsp", "VOLUME", 15],
    ["pcs", "pcs", "COUNT", 1],
    ["dozen", "dozen", "COUNT", 12],
  ])("resolves %s to %s (%s ×%d)", (input, code, dimension, factor) => {
    const unit = resolveUnit(input);
    expect(unit.code).toBe(code);
    expect(unit.dimension).toBe(dimension);
    expect(unit.factor).toBe(factor);
  });

  it("treats size descriptors as a single piece", () => {
    expect(resolveUnit("small").code).toBe("pcs");
    expect(resolveUnit("large").dimension).toBe("COUNT");
  });

  it("gives unknown units their own opaque dimension", () => {
    expect(resolveUnit("bunch").dimension).toBe("OPAQUE:bunch");
    expect(resolveUnit("gizmo").dimension).toBe("OPAQUE:gizmo");
    expect(isOpaque("bunch")).toBe(true);
    expect(isOpaque("kg")).toBe(false);
  });
});

describe("convert", () => {
  it("converts within mass", () => {
    expect(convert(1, "kg", "g")).toBe(1000);
    expect(convert(150, "g", "kg")).toBe(0.15);
    expect(convert(500, "mg", "g")).toBe(0.5);
  });

  it("converts within volume", () => {
    expect(convert(1, "l", "ml")).toBe(1000);
    expect(convert(1, "tbsp", "tsp")).toBe(3);
    expect(convert(8, "ml", "l")).toBe(0.008);
  });

  it("converts within count", () => {
    expect(convert(2, "dozen", "pcs")).toBe(24);
  });

  it("is identity for the same unit", () => {
    expect(convert(3.5, "kg", "kg")).toBe(3.5);
    expect(convert(2, "bunch", "bunch")).toBe(2);
  });

  // §6.2 — the whole point: refuse rather than invent.
  it("returns null across dimensions instead of guessing", () => {
    expect(convert(1, "kg", "l")).toBeNull();
    expect(convert(1, "bunch", "kg")).toBeNull();
    expect(convert(1, "pcs", "g")).toBeNull();
    expect(convert(1, "bunch", "sprig")).toBeNull();
  });

  it("reports convertibility without performing the conversion", () => {
    expect(canConvert("g", "kg")).toBe(true);
    expect(canConvert("g", "ml")).toBe(false);
  });

  it("rounds to the 3 decimal places the database column holds", () => {
    expect(convert(1, "tsp", "l")).toBe(0.005);
    expect(convert(1, "g", "kg")).toBe(0.001);
  });
});

describe("toBase", () => {
  it("expresses a quantity in its dimension base unit", () => {
    expect(toBase(2, "kg")).toEqual({ amount: 2000, unit: "g" });
    expect(toBase(1, "tbsp")).toEqual({ amount: 15, unit: "ml" });
    expect(toBase(3, "bunch")).toEqual({ amount: 3, unit: "bunch" });
  });
});

describe("parseQuantity", () => {
  it.each([
    ["60g", 60, "g"],
    ["150g", 150, "g"],
    ["8ml", 8, "ml"],
    ["4 g", 4, "g"],
    ["10g", 10, "g"],
  ])("parses %s", (input, amount, unit) => {
    expect(parseQuantity(input)).toEqual({ amount, unit });
  });

  it("parses vulgar fractions", () => {
    expect(parseQuantity("¼ tsp")).toEqual({ amount: 0.25, unit: "tsp" });
    expect(parseQuantity("½ tsp")).toEqual({ amount: 0.5, unit: "tsp" });
    expect(parseQuantity("¾")).toEqual({ amount: 0.75, unit: "pcs" });
  });

  it("parses written fractions and mixed numbers", () => {
    expect(parseQuantity("1/2 cup")).toEqual({ amount: 0.5, unit: "cup" });
    expect(parseQuantity("1½ kg")).toEqual({ amount: 1.5, unit: "kg" });
  });

  it("treats a bare number as a count", () => {
    expect(parseQuantity("3")).toEqual({ amount: 3, unit: "pcs" });
  });

  it("treats a bare unit as one of that unit", () => {
    expect(parseQuantity("pinch")).toEqual({ amount: 1, unit: "pinch" });
  });

  // The interesting prototype cases — see Kosh_Recipe_Database.html:198
  it("ignores a parenthetical that is not a measurable quantity", () => {
    expect(parseQuantity("8 (from 4 eggs)")).toEqual({ amount: 8, unit: "pcs" });
  });

  it("prefers a parenthetical that gives a real mass", () => {
    expect(parseQuantity("1 slice (45g)")).toEqual({ amount: 45, unit: "g" });
    expect(parseQuantity("1 (20g)")).toEqual({ amount: 20, unit: "g" });
  });

  it("normalises plural opaque units", () => {
    expect(parseQuantity("6 leaves")).toEqual({ amount: 6, unit: "leaf" });
  });

  it("collapses size descriptors to pieces", () => {
    expect(parseQuantity("1 small")).toEqual({ amount: 1, unit: "pcs" });
  });

  it("falls back to one piece for unparseable input", () => {
    expect(parseQuantity("")).toEqual({ amount: 1, unit: "pcs" });
    expect(parseQuantity("   ")).toEqual({ amount: 1, unit: "pcs" });
  });
});

describe("formatQuantity", () => {
  it("prints integers without decimals and trims trailing zeros", () => {
    expect(formatQuantity(2, "kg")).toBe("2 kg");
    expect(formatQuantity(0.25, "tsp")).toBe("0.25 tsp");
    expect(formatQuantity(1.5, "l")).toBe("1.5 l");
  });
});
