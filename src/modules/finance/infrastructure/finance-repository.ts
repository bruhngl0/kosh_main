import type { CashTransaction, RecurringCost } from "@prisma/client";
import type { DbClient } from "@/server/db";
import { toDateString, toNumber } from "@/shared/money";
import type { LedgerEntry, RecurringCostInput } from "@/modules/finance/domain/cash-flow";

/** Prisma access for finance. The only file in the module that touches the database. */

/** `@db.Date` columns round-trip as UTC midnight. */
export const dateColumn = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

export function toLedgerEntry(row: CashTransaction): LedgerEntry {
  return {
    id: row.id,
    date: toDateString(row.date)!,
    direction: row.direction,
    category: row.category,
    description: row.description,
    amount: toNumber(row.amount),
    notes: row.notes,
    purchaseOrderId: row.purchaseOrderId,
    recurringCostId: row.recurringCostId,
    createdAt: row.createdAt.toISOString(),
  };
}

export const toRecurringCost = (row: RecurringCost): RecurringCostInput & { active: boolean } => ({
  id: row.id,
  name: row.name,
  category: row.category,
  amount: toNumber(row.amount),
  active: row.active,
});

export async function listEntries(client: DbClient, range: { from: string; to: string }) {
  const rows = await client.cashTransaction.findMany({
    where: { date: { gte: dateColumn(range.from), lte: dateColumn(range.to) } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toLedgerEntry);
}

/** Net movement per month for every month before `month` — one grouped query. */
export async function netByMonthBefore(client: DbClient, month: string): Promise<Map<string, number>> {
  const rows = await client.$queryRaw<{ month: string; net: unknown }[]>`
    SELECT to_char(date, 'YYYY-MM') AS month,
           SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS net
    FROM cash_transactions
    WHERE date < ${dateColumn(`${month}-01`)}
    GROUP BY 1
  `;
  return new Map(rows.map((row) => [row.month, toNumber(row.net as string)]));
}

export async function openingBalances(client: DbClient): Promise<Map<string, number>> {
  const rows = await client.cashOpeningBalance.findMany();
  return new Map(rows.map((row) => [row.month, toNumber(row.amount)]));
}

export async function listRecurring(client: DbClient, filter: { activeOnly?: boolean } = {}) {
  const rows = await client.recurringCost.findMany({
    where: filter.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { amount: "desc" }, { name: "asc" }],
  });
  return rows.map(toRecurringCost);
}

export async function importedPurchaseOrderIds(client: DbClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await client.cashTransaction.findMany({
    where: { purchaseOrderId: { in: ids } },
    select: { purchaseOrderId: true },
  });
  return new Set(rows.map((row) => row.purchaseOrderId!));
}
