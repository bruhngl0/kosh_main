/** Finance module — public surface. See docs/system-design.md §4.3 and BR-19..BR-22. */

export {
  getMonthView,
  exportMonthCsv,
  listRecurringCosts,
  createCashTransaction,
  updateCashTransaction,
  deleteCashTransaction,
  setOpeningBalance,
  importPurchaseOrders,
  createRecurringCost,
  updateRecurringCost,
  postRecurringCost,
} from "@/modules/finance/application/cash-flow";

export {
  buildMonthView,
  kitchenDate,
  resolveOpeningBalance,
  type MonthView,
  type LedgerEntry,
} from "@/modules/finance/domain/cash-flow";
