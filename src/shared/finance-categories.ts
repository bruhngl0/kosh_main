/**
 * Cash flow categories. Kept free of zod so client components can import them
 * without pulling the validation library into the browser bundle.
 */

export const CASH_IN_CATEGORIES = ["Subscriptions", "Kit Deposits", "Staples & Air Menu", "Other Income"] as const;

export const CASH_OUT_CATEGORIES = [
  "Ingredients",
  "Kitchen Staff",
  "Delivery",
  "Vessels & Packaging",
  "Rent",
  "Utilities",
  "Marketing",
  "Equipment",
  "Compliance",
  "Miscellaneous",
] as const;

export type CashInCategory = (typeof CASH_IN_CATEGORIES)[number];
export type CashOutCategory = (typeof CASH_OUT_CATEGORIES)[number];
export type CashCategory = CashInCategory | CashOutCategory;

/** Category the purchase-order import posts under (BR-21). */
export const INGREDIENTS_CATEGORY: CashOutCategory = "Ingredients";
