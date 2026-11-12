import { z } from "zod";
import { CASH_IN_CATEGORIES, CASH_OUT_CATEGORIES, type CashOutCategory } from "@/shared/finance-categories";

/**
 * Finance contracts — shared by the /finance screen and the route handlers.
 * See docs/system-design.md BR-19..BR-22.
 */

export {
  CASH_IN_CATEGORIES,
  CASH_OUT_CATEGORIES,
  INGREDIENTS_CATEGORY,
  type CashCategory,
  type CashInCategory,
  type CashOutCategory,
} from "@/shared/finance-categories";

export const cashDirectionSchema = z.enum(["IN", "OUT"]);
export type CashDirection = z.infer<typeof cashDirectionSchema>;

export const categoriesFor = (direction: CashDirection): readonly string[] =>
  direction === "IN" ? CASH_IN_CATEGORIES : CASH_OUT_CATEGORIES;

/** "YYYY-MM". */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must look like 2026-11.");

/** "YYYY-MM-DD" that is a real calendar date. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must look like 2026-11-12.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Not a real calendar date.");

const amountSchema = z
  .number({ invalid_type_error: "Amount must be a number." })
  .finite("Amount must be a number.")
  .positive("Amount must be more than zero.")
  .max(9_999_999_999.99, "Amount is too large.")
  .transform((value) => Math.round(value * 100) / 100);

const textSchema = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

const notesSchema = z
  .string()
  .trim()
  .max(500, "Notes are too long.")
  .nullish()
  .transform((value) => (value ? value : null));

const transactionFields = {
  date: isoDateSchema,
  direction: cashDirectionSchema,
  category: textSchema("Category", 60),
  description: textSchema("Description", 200),
  amount: amountSchema,
  notes: notesSchema,
};

/** BR-19: the category must belong to the transaction's direction. */
const categoryMatchesDirection = (value: { direction?: CashDirection; category?: string }) =>
  !value.direction || !value.category || categoriesFor(value.direction).includes(value.category);

const categoryIssue = { message: "That category does not match the transaction type.", path: ["category"] };

export const createCashTransactionSchema = z
  .object(transactionFields)
  .refine(categoryMatchesDirection, categoryIssue);

/**
 * Partial update. Direction and category are re-validated together against the
 * stored row in the use case, because either may change alone.
 */
export const updateCashTransactionSchema = z
  .object(transactionFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const openingBalanceSchema = z.object({
  /** null clears the hand-set balance so the month falls back to carry-forward. */
  amount: z.number().finite().min(-9_999_999_999.99).max(9_999_999_999.99).nullable(),
});

export const createRecurringCostSchema = z
  .object({
    name: textSchema("Name", 120),
    category: textSchema("Category", 60),
    amount: amountSchema,
  })
  .refine((value) => CASH_OUT_CATEGORIES.includes(value.category as CashOutCategory), {
    message: "Fixed costs must use an expense category.",
    path: ["category"],
  });

export const updateRecurringCostSchema = z
  .object({
    name: textSchema("Name", 120),
    category: z.enum(CASH_OUT_CATEGORIES, { errorMap: () => ({ message: "Fixed costs must use an expense category." }) }),
    amount: amountSchema,
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const postRecurringCostSchema = z.object({ month: monthSchema, date: isoDateSchema.optional() });

export type CreateCashTransactionInput = z.output<typeof createCashTransactionSchema>;
export type UpdateCashTransactionInput = z.output<typeof updateCashTransactionSchema>;
export type CreateRecurringCostInput = z.output<typeof createRecurringCostSchema>;
export type UpdateRecurringCostInput = z.output<typeof updateRecurringCostSchema>;
