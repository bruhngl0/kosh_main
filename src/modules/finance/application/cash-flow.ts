import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { AppError, conflict, notFound } from "@/server/errors";
import { listCycles } from "@/modules/cycles";
import { listReceivedOrderCosts } from "@/modules/procurement";
import {
  buildMonthView,
  kitchenDate,
  kitchenMonthRange,
  monthBounds,
  monthOf,
  resolveOpeningBalance,
  shiftMonth,
  toCsv,
} from "@/modules/finance/domain/cash-flow";
import * as repository from "@/modules/finance/infrastructure/finance-repository";
import {
  categoriesFor,
  INGREDIENTS_CATEGORY,
  type CashDirection,
  type CreateCashTransactionInput,
  type CreateRecurringCostInput,
  type UpdateCashTransactionInput,
  type UpdateRecurringCostInput,
} from "@/shared/schemas/finance";

type Context = { actor: Actor; requestId: string };

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Everything the /finance screen shows for one month, in one call: ledger with
 * running balance, totals, weeks, categories, fixed-cost status, danger flags,
 * and received purchase orders not yet in the ledger.
 */
export async function getMonthView(month: string) {
  const range = monthBounds(month);

  const [entries, nets, handSet, recurring, received, cycles] = await Promise.all([
    repository.listEntries(db, range),
    repository.netByMonthBefore(db, month),
    repository.openingBalances(db),
    repository.listRecurring(db, { activeOnly: true }),
    listReceivedOrderCosts(kitchenMonthRange(month)),
    listCycles(),
  ]);

  const imported = await repository.importedPurchaseOrderIds(
    db,
    received.map((order) => order.purchaseOrderId),
  );

  const view = buildMonthView({
    month,
    opening: resolveOpeningBalance(month, handSet, nets),
    entries,
    recurring,
    foodCostTargetPercent: cycles[0]?.foodCostTargetPercent ?? null,
  });

  const pending = received
    .filter((order) => !imported.has(order.purchaseOrderId) && order.cost > 0)
    .map((order) => ({ ...order, receivedAt: order.receivedAt.toISOString(), date: kitchenDate(order.receivedAt) }));

  return {
    ...view,
    previousMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    pendingPurchaseOrders: {
      count: pending.length,
      total: Math.round(pending.reduce((sum, order) => sum + order.cost, 0) * 100) / 100,
      orders: pending,
    },
  };
}

export async function exportMonthCsv(month: string) {
  const view = await getMonthView(month);
  return toCsv(view.rows);
}

export async function listRecurringCosts() {
  return repository.listRecurring(db);
}

// ── Transactions ─────────────────────────────────────────────────────────────

export async function createCashTransaction(input: CreateCashTransactionInput, context: Context) {
  assertCan(context.actor, "finance:write");

  return db.$transaction(async (tx) => {
    const row = await tx.cashTransaction.create({
      data: { ...input, date: repository.dateColumn(input.date) },
    });
    const entry = repository.toLedgerEntry(row);
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cash_transaction.created",
      entityType: "CashTransaction",
      entityId: row.id,
      after: entry,
      requestId: context.requestId,
    });
    return entry;
  });
}

export async function updateCashTransaction(id: string, input: UpdateCashTransactionInput, context: Context) {
  assertCan(context.actor, "finance:write");

  const before = await db.cashTransaction.findUnique({ where: { id } });
  if (!before) throw notFound("Transaction", id);

  // BR-19: either field may change alone, so check the combination that results.
  const direction = (input.direction ?? before.direction) as CashDirection;
  const category = input.category ?? before.category;
  if (!categoriesFor(direction).includes(category)) {
    throw new AppError("VALIDATION_ERROR", "That category does not match the transaction type.", {
      fields: { category: ["That category does not match the transaction type."] },
    });
  }

  return db.$transaction(async (tx) => {
    const row = await tx.cashTransaction.update({
      where: { id },
      data: { ...input, ...(input.date ? { date: repository.dateColumn(input.date) } : {}) },
    });
    const entry = repository.toLedgerEntry(row);
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cash_transaction.updated",
      entityType: "CashTransaction",
      entityId: id,
      before: repository.toLedgerEntry(before),
      after: entry,
      requestId: context.requestId,
    });
    return entry;
  });
}

/**
 * Hard delete. Unlike vendors or recipes nothing references a ledger row, and
 * the audit event keeps the full "before" snapshot, so the history survives.
 */
export async function deleteCashTransaction(id: string, context: Context) {
  assertCan(context.actor, "finance:write");

  const before = await db.cashTransaction.findUnique({ where: { id } });
  if (!before) throw notFound("Transaction", id);

  await db.$transaction(async (tx) => {
    await tx.cashTransaction.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cash_transaction.deleted",
      entityType: "CashTransaction",
      entityId: id,
      before: repository.toLedgerEntry(before),
      requestId: context.requestId,
    });
  });
  return { id, deleted: true };
}

// ── BR-20: opening balance ───────────────────────────────────────────────────

export async function setOpeningBalance(month: string, amount: number | null, context: Context) {
  assertCan(context.actor, "finance:write");

  return db.$transaction(async (tx) => {
    const before = await tx.cashOpeningBalance.findUnique({ where: { month } });
    if (amount === null) {
      if (before) await tx.cashOpeningBalance.delete({ where: { month } });
    } else {
      await tx.cashOpeningBalance.upsert({ where: { month }, create: { month, amount }, update: { amount } });
    }
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cash_opening_balance.set",
      entityType: "CashOpeningBalance",
      entityId: month,
      before: before ? { amount: before.amount } : null,
      after: { amount },
      requestId: context.requestId,
    });
    return { month, amount };
  });
}

// ── BR-21: purchase order import ─────────────────────────────────────────────

/**
 * Posts every fully received purchase order in the month as an Ingredients
 * expense, dated the day it was received. Idempotent: the unique
 * `purchase_order_id` column means a second run, or two people clicking at
 * once, can never double-count an order.
 */
export async function importPurchaseOrders(month: string, context: Context) {
  assertCan(context.actor, "finance:write");

  const received = await listReceivedOrderCosts(kitchenMonthRange(month));
  const already = await repository.importedPurchaseOrderIds(db, received.map((o) => o.purchaseOrderId));
  const toImport = received.filter((order) => !already.has(order.purchaseOrderId) && order.cost > 0);

  if (!toImport.length) return { imported: 0, total: 0, skippedUnpriced: received.filter((o) => o.cost <= 0).length };

  const result = await db.$transaction(async (tx) => {
    const created = await tx.cashTransaction.createManyAndReturn({
      data: toImport.map((order) => ({
        date: repository.dateColumn(kitchenDate(order.receivedAt)),
        direction: "OUT" as const,
        category: INGREDIENTS_CATEGORY,
        description: `Purchase order — ${order.vendorName}`,
        amount: order.cost,
        notes: order.unpricedLineCount
          ? `${order.unpricedLineCount} of ${order.lineCount} lines had no unit cost and are not included`
          : null,
        purchaseOrderId: order.purchaseOrderId,
      })),
      skipDuplicates: true,
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cash_transaction.imported",
      entityType: "CashTransaction",
      entityId: month,
      after: created.map((row) => ({ id: row.id, purchaseOrderId: row.purchaseOrderId, amount: row.amount })),
      requestId: context.requestId,
    });
    return created;
  });

  return {
    imported: result.length,
    total: Math.round(result.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100,
    skippedUnpriced: received.filter((o) => o.cost <= 0).length,
  };
}

// ── BR-22: fixed costs ───────────────────────────────────────────────────────

export async function createRecurringCost(input: CreateRecurringCostInput, context: Context) {
  assertCan(context.actor, "finance:write");

  const existing = await db.recurringCost.findUnique({ where: { name: input.name }, select: { id: true } });
  if (existing) throw conflict(`A fixed cost called "${input.name}" already exists.`, { recurringCostId: existing.id });

  return db.$transaction(async (tx) => {
    const row = await tx.recurringCost.create({ data: input });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recurring_cost.created",
      entityType: "RecurringCost",
      entityId: row.id,
      after: row,
      requestId: context.requestId,
    });
    return repository.toRecurringCost(row);
  });
}

export async function updateRecurringCost(id: string, input: UpdateRecurringCostInput, context: Context) {
  assertCan(context.actor, "finance:write");

  const before = await db.recurringCost.findUnique({ where: { id } });
  if (!before) throw notFound("Fixed cost", id);

  return db.$transaction(async (tx) => {
    const row = await tx.recurringCost.update({ where: { id }, data: input });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recurring_cost.updated",
      entityType: "RecurringCost",
      entityId: id,
      before,
      after: row,
      requestId: context.requestId,
    });
    return repository.toRecurringCost(row);
  });
}

/**
 * Logs a fixed cost as paid for a month. Refuses a second posting in the same
 * month so a double click cannot pay rent twice.
 */
export async function postRecurringCost(id: string, input: { month: string; date?: string }, context: Context) {
  assertCan(context.actor, "finance:write");

  const cost = await db.recurringCost.findUnique({ where: { id } });
  if (!cost) throw notFound("Fixed cost", id);

  const date = input.date ?? defaultPostingDate(input.month);
  if (monthOf(date) !== input.month) {
    throw new AppError("VALIDATION_ERROR", "The payment date must fall inside the month being posted.", {
      fields: { date: ["The payment date must fall inside the month being posted."] },
    });
  }

  const { from, to } = monthBounds(input.month);
  return db.$transaction(async (tx) => {
    const existing = await tx.cashTransaction.findFirst({
      where: { recurringCostId: id, date: { gte: repository.dateColumn(from), lte: repository.dateColumn(to) } },
      select: { id: true },
    });
    if (existing) throw conflict(`${cost.name} is already posted for ${input.month}.`, { transactionId: existing.id });

    const row = await tx.cashTransaction.create({
      data: {
        date: repository.dateColumn(date),
        direction: "OUT",
        category: cost.category,
        description: cost.name,
        amount: cost.amount,
        notes: "Fixed cost",
        recurringCostId: id,
      },
    });
    const entry = repository.toLedgerEntry(row);
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cash_transaction.created",
      entityType: "CashTransaction",
      entityId: row.id,
      after: entry,
      requestId: context.requestId,
    });
    return entry;
  });
}

/** Today if it is in that month, otherwise the 1st. Kitchen-local. */
function defaultPostingDate(month: string) {
  const today = kitchenDate(new Date());
  return monthOf(today) === month ? today : `${month}-01`;
}
