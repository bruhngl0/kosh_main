/**
 * Decimal and money helpers. See docs/system-design.md §5.
 *
 * Prisma returns DECIMAL columns as Decimal objects that serialise to JSON
 * strings. That preserves precision on the wire, but domain functions work in
 * numbers — these helpers are the single conversion point.
 */

/** Anything Prisma might hand back for a numeric column. */
type DecimalLike = { toString(): string } | number | string | null | undefined;

/** Converts a Decimal, string, or number to a number. Nullish becomes `fallback`. */
export function toNumber(value: DecimalLike, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Converts to a number, preserving null so "no price" stays distinct from ₹0. */
export function toNullableNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export const formatInr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export const formatInrPrecise = (value: number) =>
  `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ISO date (yyyy-mm-dd) for a Date, or null. Used for `@db.Date` columns. */
export const toDateString = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
