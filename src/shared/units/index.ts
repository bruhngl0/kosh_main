/**
 * Unit registry and conversion. See docs/system-design.md §6.
 *
 * Recipes are authored in cooking units (150g chicken, ¼ tsp turmeric, 1 bunch
 * coriander). Stock and vendor pricing use purchase units (kg, L, pcs).
 * Comparing them without conversion is how a purchase order ends up wrong by
 * three orders of magnitude.
 *
 * Pure module: no I/O, no database, no framework. Fully unit-tested.
 */

export type Dimension = "MASS" | "VOLUME" | "COUNT" | `OPAQUE:${string}`;

export type UnitInfo = {
  /** Canonical code for this unit, e.g. `kg` for an input of `kilogram`. */
  code: string;
  dimension: Dimension;
  /** How many base units one of this unit is worth. */
  factor: number;
  /** Base unit code for the dimension. */
  base: string;
};

type Definition = { code: string; dimension: "MASS" | "VOLUME" | "COUNT"; factor: number; aliases: string[] };

const BASE_BY_DIMENSION = { MASS: "g", VOLUME: "ml", COUNT: "pcs" } as const;

/**
 * Convertible units. Anything not listed becomes an OPAQUE unit that converts
 * only to itself — see `resolveUnit`.
 */
const DEFINITIONS: Definition[] = [
  // Mass — base gram.
  { code: "mg", dimension: "MASS", factor: 0.001, aliases: ["mg", "milligram", "milligrams"] },
  { code: "g", dimension: "MASS", factor: 1, aliases: ["g", "gm", "gms", "gram", "grams", "grm"] },
  { code: "kg", dimension: "MASS", factor: 1000, aliases: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"] },

  // Volume — base millilitre. Spoon and cup sizes use metric conventions.
  { code: "ml", dimension: "VOLUME", factor: 1, aliases: ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters"] },
  { code: "tsp", dimension: "VOLUME", factor: 5, aliases: ["tsp", "teaspoon", "teaspoons"] },
  { code: "tbsp", dimension: "VOLUME", factor: 15, aliases: ["tbsp", "tbs", "tablespoon", "tablespoons"] },
  { code: "cup", dimension: "VOLUME", factor: 240, aliases: ["cup", "cups"] },
  { code: "l", dimension: "VOLUME", factor: 1000, aliases: ["l", "ltr", "ltrs", "litre", "litres", "liter", "liters"] },

  // Count — base piece. Size descriptors collapse to a piece: "1 small" is one
  // shallot, and the adjective is a prep note, not a unit.
  {
    code: "pcs",
    dimension: "COUNT",
    factor: 1,
    aliases: ["pcs", "pc", "piece", "pieces", "no", "nos", "unit", "units", "each", "small", "medium", "large", "whole"],
  },
  { code: "dozen", dimension: "COUNT", factor: 12, aliases: ["dozen", "dozens", "doz"] },
];

/** Opaque units are real and useful, but genuinely not interconvertible. */
const KNOWN_OPAQUE = [
  "bunch",
  "portion",
  "slice",
  "pinch",
  "roll",
  "btl",
  "bottle",
  "leaf",
  "sprig",
  "clove",
  "can",
  "tin",
  "packet",
  "sachet",
  "pod",
  "stick",
  "head",
  "handful",
  "drizzle",
  "dash",
];

/** Plural and spelling variants that fold onto a canonical opaque code. */
const OPAQUE_ALIASES: Record<string, string> = {
  bunches: "bunch",
  portions: "portion",
  slices: "slice",
  pinches: "pinch",
  rolls: "roll",
  bottles: "bottle",
  btls: "btl",
  leaves: "leaf",
  sprigs: "sprig",
  cloves: "clove",
  cans: "can",
  tins: "tin",
  packets: "packet",
  sachets: "sachet",
  pods: "pod",
  sticks: "stick",
  heads: "head",
  handfuls: "handful",
};

const BY_ALIAS = new Map<string, Definition>();
for (const definition of DEFINITIONS) {
  for (const alias of definition.aliases) BY_ALIAS.set(alias, definition);
}

/** Lowercase, strip punctuation and whitespace, fold known plurals. */
export function normaliseUnit(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
  return OPAQUE_ALIASES[cleaned] ?? cleaned;
}

/**
 * Resolves any unit string. Unknown units are not an error — they become their
 * own OPAQUE dimension, which converts to itself and refuses everything else.
 */
export function resolveUnit(raw: string): UnitInfo {
  const code = normaliseUnit(raw);
  const definition = BY_ALIAS.get(code);

  if (definition) {
    return {
      code: definition.code,
      dimension: definition.dimension,
      factor: definition.factor,
      base: BASE_BY_DIMENSION[definition.dimension],
    };
  }

  const opaque = code || "unit";
  return { code: opaque, dimension: `OPAQUE:${opaque}`, factor: 1, base: opaque };
}

export const isOpaque = (raw: string) => resolveUnit(raw).dimension.startsWith("OPAQUE:");

/**
 * True when a unit is one we recognise — convertible, or a known opaque unit.
 *
 * Unknown units still resolve (to their own opaque dimension) rather than
 * failing, so this exists to flag likely typos: "bunhc" behaves identically to
 * "bunch" at conversion time but is almost certainly a mistake.
 */
export const isKnownUnit = (raw: string) => {
  const code = normaliseUnit(raw);
  return BY_ALIAS.has(code) || KNOWN_OPAQUE.includes(code);
};

export const sameDimension = (a: string, b: string) =>
  resolveUnit(a).dimension === resolveUnit(b).dimension;

export const canConvert = sameDimension;

/**
 * Converts between units of the same dimension.
 * Returns `null` when the units are not interconvertible — callers must handle
 * that explicitly rather than receiving a plausible wrong number (§6.2).
 */
export function convert(amount: number, from: string, to: string): number | null {
  const source = resolveUnit(from);
  const target = resolveUnit(to);
  if (source.dimension !== target.dimension) return null;
  return round((amount * source.factor) / target.factor);
}

/** Converts, or throws a caller-supplied error. Keeps use cases readable. */
export function convertOrThrow(amount: number, from: string, to: string, onFailure: () => Error): number {
  const result = convert(amount, from, to);
  if (result === null) throw onFailure();
  return result;
}

/** Expresses an amount in its dimension's base unit. */
export function toBase(amount: number, unit: string): { amount: number; unit: string } {
  const info = resolveUnit(unit);
  return { amount: round(amount * info.factor), unit: info.base };
}

/** Quantities are DECIMAL(12,3) in the database; keep arithmetic consistent. */
export const round = (value: number, precision = 3) => {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function formatQuantity(amount: number, unit: string): string {
  const info = resolveUnit(unit);
  const rounded = round(amount);
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${display} ${info.code}`;
}

// ── Parsing authored quantities ──────────────────────────────────────────────

const VULGAR_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 0.2,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

export type ParsedQuantity = { amount: number; unit: string };

/**
 * Parses a human-authored quantity string from a recipe card.
 *
 * The prototypes contain shapes like `60g`, `¼ tsp`, `8 (from 4 eggs)`,
 * `1 slice (45g)`, `1 small`, `6 leaves`, and bare `pinch`. A parenthetical is
 * used only when it is itself a clean convertible quantity — `1 slice (45g)`
 * yields 45 g, whereas `8 (from 4 eggs)` correctly yields 8 pieces.
 */
export function parseQuantity(raw: string): ParsedQuantity {
  const input = (raw ?? "").trim();
  if (!input) return { amount: 1, unit: "pcs" };

  const parenthetical = input.match(/\(([^)]*)\)/)?.[1];
  const withoutParens = input.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  if (parenthetical) {
    const inner = parseSimple(parenthetical.trim());
    // Only trust the parenthetical when it names a measurable unit.
    if (inner && !isOpaque(inner.unit) && resolveUnit(inner.unit).dimension !== "COUNT") {
      return inner;
    }
  }

  return parseSimple(withoutParens) ?? { amount: 1, unit: "pcs" };
}

/**
 * Numeric prefixes, most specific first. Written fractions must be tried before
 * plain integers, or the leading digit of `1/2` is consumed as a whole number.
 */
const NUMERIC_PATTERNS: { pattern: RegExp; value: (groups: string[]) => number }[] = [
  // "1 1/2 cup"
  { pattern: /^([0-9]+)\s+([0-9]+)\s*\/\s*([0-9]+)\s*/, value: ([a, b, c]) => Number(a) + Number(b) / Number(c) },
  // "1/2 cup"
  { pattern: /^([0-9]+)\s*\/\s*([0-9]+)\s*/, value: ([a, b]) => Number(a) / Number(b) },
  // "1½ kg"
  {
    pattern: /^([0-9]+(?:\.[0-9]+)?)\s*([¼½¾⅓⅔⅕⅛⅜⅝⅞])\s*/,
    value: ([a, f]) => Number(a) + (VULGAR_FRACTIONS[f] ?? 0),
  },
  // "¼ tsp"
  { pattern: /^([¼½¾⅓⅔⅕⅛⅜⅝⅞])\s*/, value: ([f]) => VULGAR_FRACTIONS[f] ?? 0 },
  // "60g", "1.5 kg"
  { pattern: /^([0-9]+(?:\.[0-9]+)?)\s*/, value: ([a]) => Number(a) },
];

function parseSimple(text: string): ParsedQuantity | null {
  if (!text) return null;

  for (const { pattern, value } of NUMERIC_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const amount = value(match.slice(1));
    const unitText = text.slice(match[0].length).trim();
    // A bare number is a count: "3" is three of the thing.
    return { amount: round(amount), unit: unitText ? resolveUnit(unitText).code : "pcs" };
  }

  // No number at all — "pinch" means one pinch.
  return { amount: 1, unit: resolveUnit(text).code };
}
