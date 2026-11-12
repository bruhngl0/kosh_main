import type { getMonthView } from "@/modules/finance";
import { CASH_IN_CATEGORIES, CASH_OUT_CATEGORIES } from "@/shared/finance-categories";
import type { CashDirection } from "@/shared/schemas/finance";

/** The /finance read model, exactly as the month endpoint returns it. */
export type FinanceView = Awaited<ReturnType<typeof getMonthView>>;
export type LedgerRow = FinanceView["rows"][number];
export type RecurringRow = FinanceView["recurring"][number];
export type RecurringCost = { id: string; name: string; category: string; amount: number; active: boolean };

export const inr = (value: number) => `₹${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;
/** Signed, with a real minus sign. */
export const signedInr = (value: number) => `${value < 0 ? "−" : ""}${inr(value)}`;

export const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export const categoriesFor = (direction: CashDirection): readonly string[] =>
  direction === "IN" ? CASH_IN_CATEGORIES : CASH_OUT_CATEGORIES;

/** Kōsh palette — greens and copper for money in, warm earth tones for money out. */
export const CATEGORY_COLORS: Record<string, string> = {
  Subscriptions: "#1A6B3C",
  "Kit Deposits": "#8B5E3C",
  "Staples & Air Menu": "#4E7A3A",
  "Other Income": "#6A7F5C",
  Ingredients: "#A32D2D",
  "Kitchen Staff": "#7A3B22",
  Delivery: "#1A3B6B",
  "Vessels & Packaging": "#9A6A10",
  Rent: "#3D3A30",
  Utilities: "#6A6058",
  Marketing: "#B0582E",
  Equipment: "#5C4A36",
  Compliance: "#55606B",
  Miscellaneous: "#8C8070",
};

export const colorFor = (category: string) => CATEGORY_COLORS[category] ?? "#8C8070";
