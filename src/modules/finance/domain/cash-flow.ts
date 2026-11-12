/**
 * Cash flow rules. Pure — no I/O. See docs/system-design.md BR-19..BR-22.
 *
 * Money is handled in rupees as numbers here; amounts are DECIMAL(12,2) in the
 * database and every arithmetic result is rounded back to paise so running
 * balances never drift by floating-point dust.
 */

export type CashDirection = "IN" | "OUT";

export type LedgerEntry = {
  id: string;
  /** yyyy-mm-dd */
  date: string;
  direction: CashDirection;
  category: string;
  description: string;
  amount: number;
  notes: string | null;
  purchaseOrderId: string | null;
  recurringCostId: string | null;
  createdAt: string;
};

export type RecurringCostInput = { id: string; name: string; category: string; amount: number };

export type AlertLevel = "danger" | "warn" | "ok";

/** Below this, a positive month-end balance is still flagged (BR-20). */
export const LOW_CASH_THRESHOLD = 100_000;

const paise = (value: number) => Math.round(value * 100) / 100;
export const signedAmount = (entry: Pick<LedgerEntry, "direction" | "amount">) =>
  entry.direction === "IN" ? entry.amount : -entry.amount;

// ── Months ───────────────────────────────────────────────────────────────────

export function parseMonth(month: string): { year: number; monthIndex: number } {
  const [year, m] = month.split("-").map(Number);
  return { year, monthIndex: m - 1 };
}

export function daysInMonth(month: string): number {
  const { year, monthIndex } = parseMonth(month);
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** First and last calendar day, as yyyy-mm-dd. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonth(month);
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

/**
 * Weeks are fixed day ranges — 1–7, 8–14, 15–21, 22–28, 29–end — so the
 * ledger, the weekly cards and the chart always agree on what "week 2" is,
 * whatever weekday the month starts on.
 */
export function monthWeeks(month: string): { start: number; end: number }[] {
  const last = daysInMonth(month);
  const weeks: { start: number; end: number }[] = [];
  for (let start = 1; start <= last; start += 7) weeks.push({ start, end: Math.min(start + 6, last) });
  return weeks;
}

// ── BR-20: opening balance ───────────────────────────────────────────────────

export type OpeningBalance = { amount: number; source: "set" | "carried" | "none" };

/**
 * A month's opening balance is the hand-set figure if there is one; otherwise
 * it is the previous month's closing balance, carried forward through every
 * earlier month. A hand-set balance in an earlier month resets the chain from
 * that point — it is how the owner reconciles against the bank.
 */
export function resolveOpeningBalance(
  month: string,
  handSet: ReadonlyMap<string, number>,
  netByMonth: ReadonlyMap<string, number>,
): OpeningBalance {
  const own = handSet.get(month);
  if (own !== undefined) return { amount: paise(own), source: "set" };

  const earlier = [...new Set([...handSet.keys(), ...netByMonth.keys()])].filter((m) => m < month).sort();
  if (!earlier.length) return { amount: 0, source: "none" };

  let balance = 0;
  for (const m of earlier) {
    const reset = handSet.get(m);
    if (reset !== undefined) balance = reset;
    balance += netByMonth.get(m) ?? 0;
  }
  return { amount: paise(balance), source: "carried" };
}

// ── BR-22: fixed costs ───────────────────────────────────────────────────────

/**
 * A fixed cost counts as paid this month when an expense was posted from it,
 * or when an expense's description names it (for costs logged by hand).
 */
export function isRecurringPaid(cost: RecurringCostInput, entries: readonly LedgerEntry[]): boolean {
  const name = cost.name.trim().toLowerCase();
  return entries.some(
    (entry) =>
      entry.direction === "OUT" &&
      (entry.recurringCostId === cost.id || (name.length > 0 && entry.description.toLowerCase().includes(name))),
  );
}

// ── Month view ───────────────────────────────────────────────────────────────

export type MonthViewInput = {
  month: string;
  opening: OpeningBalance;
  entries: readonly LedgerEntry[];
  recurring: readonly RecurringCostInput[];
  /** Food-cost target in percent; warns above it, flags danger 5 points over. */
  foodCostTargetPercent?: number | null;
};

export function buildMonthView(input: MonthViewInput) {
  const { month, opening } = input;
  const entries = [...input.entries]
    .filter((entry) => monthOf(entry.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  // Running balance in date order. Same-day rows keep entry order.
  let running = opening.amount;
  const rows = entries.map((entry) => {
    running = paise(running + signedAmount(entry));
    return { ...entry, balance: running };
  });

  const income = paise(entries.filter((e) => e.direction === "IN").reduce((sum, e) => sum + e.amount, 0));
  const expenses = paise(entries.filter((e) => e.direction === "OUT").reduce((sum, e) => sum + e.amount, 0));
  const net = paise(income - expenses);
  const closing = paise(opening.amount + net);

  const day = (entry: LedgerEntry) => Number(entry.date.slice(8, 10));

  let weekRunning = opening.amount;
  const weeks = monthWeeks(month).map((week) => {
    const inWeek = entries.filter((e) => day(e) >= week.start && day(e) <= week.end);
    const weekIncome = paise(inWeek.filter((e) => e.direction === "IN").reduce((s, e) => s + e.amount, 0));
    const weekExpenses = paise(inWeek.filter((e) => e.direction === "OUT").reduce((s, e) => s + e.amount, 0));
    weekRunning = paise(weekRunning + weekIncome - weekExpenses);
    return {
      ...week,
      count: inWeek.length,
      income: weekIncome,
      expenses: weekExpenses,
      net: paise(weekIncome - weekExpenses),
      closing: weekRunning,
    };
  });

  let dayRunning = opening.amount;
  const daily = Array.from({ length: daysInMonth(month) }, (_, index) => {
    for (const entry of entries) if (day(entry) === index + 1) dayRunning = paise(dayRunning + signedAmount(entry));
    return { day: index + 1, balance: dayRunning };
  });

  const categoryTotals = new Map<string, { category: string; direction: CashDirection; total: number }>();
  for (const entry of entries) {
    const key = `${entry.direction}:${entry.category}`;
    const current = categoryTotals.get(key) ?? { category: entry.category, direction: entry.direction, total: 0 };
    current.total = paise(current.total + entry.amount);
    categoryTotals.set(key, current);
  }
  const byCategory = [...categoryTotals.values()].sort((a, b) => b.total - a.total);

  const recurring = input.recurring.map((cost) => ({ ...cost, paid: isRecurringPaid(cost, entries) }));
  const unpaidFixedCosts = paise(recurring.filter((c) => !c.paid).reduce((s, c) => s + c.amount, 0));
  const projectedClosing = paise(closing - unpaidFixedCosts);

  const subscriptions = categoryTotals.get("IN:Subscriptions")?.total ?? 0;
  const ingredients = categoryTotals.get("OUT:Ingredients")?.total ?? 0;

  return {
    month,
    opening,
    rows,
    totals: { income, expenses, net, closing, subscriptions, ingredients },
    weeks,
    daily,
    byCategory,
    recurring,
    unpaidFixedCosts,
    projectedClosing,
    foodCost: foodCost(ingredients, subscriptions, input.foodCostTargetPercent),
    alert: cashAlert(closing, projectedClosing),
  };
}

export type MonthView = ReturnType<typeof buildMonthView>;

/** Ingredients as a share of subscription revenue for the month. */
export function foodCost(ingredients: number, subscriptions: number, targetPercent?: number | null) {
  const target = targetPercent ?? 30;
  if (subscriptions <= 0) return { percent: null, target, level: "ok" as AlertLevel };
  const percent = Math.round((ingredients / subscriptions) * 1000) / 10;
  const level: AlertLevel = percent > target + 5 ? "danger" : percent > target ? "warn" : "ok";
  return { percent, target, level };
}

/** BR-20 danger flags: negative now, negative once fixed costs land, or thin. */
export function cashAlert(closing: number, projectedClosing: number): { level: AlertLevel; reason: string } {
  if (closing < 0) return { level: "danger", reason: "negative-closing" };
  if (projectedClosing < 0) return { level: "danger", reason: "fixed-costs-exceed-balance" };
  if (projectedClosing < LOW_CASH_THRESHOLD) return { level: "warn", reason: "low-balance" };
  return { level: "ok", reason: "healthy" };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const csvCell = (value: string | number | null) => {
  // Numbers go out bare so a negative balance stays a number in a spreadsheet.
  if (typeof value === "number") return value.toFixed(2);
  const text = value ?? "";
  // Free text starting with =, +, -, @ would run as a formula in Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function toCsv(rows: MonthView["rows"]): string {
  const header = ["Date", "Description", "Category", "Type", "Amount", "Balance", "Notes"];
  const lines = rows.map((row) =>
    [row.date, row.description, row.category, row.direction === "IN" ? "Income" : "Expense", row.amount, row.balance, row.notes]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}

// ── Kitchen-local dates ──────────────────────────────────────────────────────

/** Bengaluru. India has no daylight saving, so a fixed offset is exact. */
export const KITCHEN_UTC_OFFSET_MINUTES = 330;
const OFFSET_MS = KITCHEN_UTC_OFFSET_MINUTES * 60_000;

/** The kitchen-local calendar date of an instant, as yyyy-mm-dd. */
export const kitchenDate = (instant: Date) => new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);

/** The instants a kitchen-local month spans: [from, to). */
export function kitchenMonthRange(month: string): { from: Date; to: Date } {
  const { year, monthIndex } = parseMonth(month);
  return {
    from: new Date(Date.UTC(year, monthIndex, 1) - OFFSET_MS),
    to: new Date(Date.UTC(year, monthIndex + 1, 1) - OFFSET_MS),
  };
}
