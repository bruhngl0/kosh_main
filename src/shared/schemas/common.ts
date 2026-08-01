import { z } from "zod";

/**
 * Shared validation primitives. See docs/system-design.md §4.2.
 *
 * These schemas are the contract for BOTH the client forms and the route
 * handlers — the client validates for immediate feedback, the server validates
 * again at the trust boundary. Nothing server-only may be imported here.
 */

export const idSchema = z.string().uuid("Must be a valid identifier.");

export const mealTypeSchema = z.enum(["BF", "SN", "LU", "DI"]);
export const cycleStatusSchema = z.enum(["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"]);
export const recipeStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const prepTaskStatusSchema = z.enum(["OPEN", "DONE", "SKIPPED"]);
export const criticalitySchema = z.enum(["info", "warning", "mandatory"]);

export const ingredientCategorySchema = z.enum([
  "protein",
  "produce",
  "grains",
  "dairy",
  "specialty",
  "pantry",
  "oils",
  "vessel",
  "recipe",
]);

export const orderFrequencySchema = z.enum(["daily", "weekly", "monthly", "adhoc"]);
export const ingredientStatusSchema = z.enum(["needed", "ordered", "received", "cancelled"]);

/** Quantities are DECIMAL(12,3); money is DECIMAL(12,2). */
export const quantitySchema = z
  .number()
  .finite("Must be a number.")
  .nonnegative("Cannot be negative.")
  .max(9_999_999.999, "Quantity is too large.");

export const positiveQuantitySchema = quantitySchema.refine((value) => value > 0, "Must be greater than zero.");

export const moneySchema = z
  .number()
  .finite("Must be a number.")
  .nonnegative("Cannot be negative.")
  .max(9_999_999_99.99, "Amount is too large.");

export const unitSchema = z.string().trim().min(1, "A unit is required.").max(20);

/** Optional free text that treats an empty form field as "not provided". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Normalises an ingredient name into its unique key. Shared so the seed, the
 *  recipe importer, and the ingredient endpoint cannot drift apart. */
export function normaliseIngredientName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  // A name of only punctuation would collapse to "" and collide with every
  // other such name on a UNIQUE column.
  return slug || `ingredient-${hash(name)}`;
}

function hash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result << 5) - result + value.charCodeAt(index);
    result |= 0;
  }
  return Math.abs(result).toString(36);
}
