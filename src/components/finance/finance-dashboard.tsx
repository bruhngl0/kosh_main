"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import { Kpi } from "@/components/inventory/panels";
import { BalanceChart, WeeklyChart } from "./charts";
import { Ledger, type QuickAddInput } from "./ledger";
import { RecurringModal, TransactionModal, type TransactionDraft } from "./modals";
import {
  colorFor,
  inr,
  monthLabel,
  signedInr,
  type FinanceView,
  type LedgerRow,
  type RecurringCost,
} from "./types";

type Tab = "ledger" | "weekly" | "charts";
const TABS: [Tab, string][] = [
  ["ledger", "Ledger"],
  ["weekly", "Weekly View"],
  ["charts", "Charts"],
];

type ModalState = { kind: "transaction"; row: LedgerRow | null } | { kind: "recurring" } | null;

export function FinanceDashboard({ initialView, today }: { initialView: FinanceView; today: string }) {
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState<Tab>("ledger");
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recurringCosts, setRecurringCosts] = useState<RecurringCost[] | null>(null);
  const { feedback, succeed, fail, clear } = useFeedback();
  const month = view.month;
  const request = useRef(0);

  /** Today when viewing the current month, otherwise the 1st of the viewed month. */
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;

  const load = useCallback(
    async (target: string) => {
      const ticket = ++request.current;
      setLoading(true);
      try {
        const next = await api.get<FinanceView>(`/finance/months/${target}`);
        // Ignore responses that arrive after a newer navigation.
        if (ticket !== request.current) return;
        setView(next);
        window.history.replaceState(null, "", `/finance?month=${target}`);
      } catch (error) {
        if (ticket === request.current) fail(errorMessage(error));
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    [fail],
  );

  const refresh = useCallback(() => load(month), [load, month]);

  /** Runs a mutation, reloads the month, reports the outcome. Returns success. */
  async function mutate(action: () => Promise<unknown>, success: string, reloadMonth = month) {
    setBusy(true);
    try {
      await action();
      await load(reloadMonth);
      succeed(success);
      return true;
    } catch (error) {
      fail(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (modal?.kind !== "recurring" || recurringCosts) return;
    api.get<RecurringCost[]>("/finance/recurring-costs").then(setRecurringCosts, (error) => fail(errorMessage(error)));
  }, [modal, recurringCosts, fail]);

  // ── Actions ──

  const saveTransaction = (draft: TransactionDraft, row: LedgerRow | null) =>
    mutate(
      () => (row ? api.patch(`/finance/transactions/${row.id}`, draft) : api.post("/finance/transactions", draft)),
      row ? "Transaction updated." : "Transaction added.",
      draft.date.slice(0, 7),
    ).then((ok) => ok && setModal(null));

  const quickAdd = (input: QuickAddInput) =>
    mutate(() => api.post("/finance/transactions", { ...input, notes: null }), "Transaction added.", input.date.slice(0, 7));

  const deleteTransaction = (row: LedgerRow) =>
    mutate(() => api.delete(`/finance/transactions/${row.id}`), "Transaction deleted.").then(
      (ok) => ok && setModal(null),
    );

  const [openingDraft, setOpeningDraft] = useState<string | null>(null);
  /** Reads the input itself, not the draft state, so a blur in the same tick as the last keystroke still saves. */
  const saveOpening = (raw: string) => {
    if (openingDraft === null && raw === (view.opening.source === "set" ? String(view.opening.amount) : "")) return;
    const value = raw.trim();
    setOpeningDraft(null);
    const amount = value === "" ? null : Number(value);
    if (amount !== null && !Number.isFinite(amount)) return fail("Opening balance must be a number.");
    if (amount === (view.opening.source === "set" ? view.opening.amount : null)) return;
    void mutate(
      () => api.put(`/finance/months/${month}/opening-balance`, { amount }),
      amount === null ? "Opening balance now carries forward from last month." : "Opening balance saved.",
    );
  };

  const importOrders = () =>
    mutate(
      () => api.post(`/finance/months/${month}/import-purchase-orders`),
      `${view.pendingPurchaseOrders.count} purchase order${view.pendingPurchaseOrders.count === 1 ? "" : "s"} added to the ledger.`,
    );

  const addRecurring = async (input: { name: string; category: string; amount: number }) => {
    const ok = await mutate(async () => {
      const created = await api.post<RecurringCost>("/finance/recurring-costs", input);
      setRecurringCosts((current) => [...(current ?? []), created]);
    }, `${input.name} added to fixed costs.`);
    return ok;
  };

  const postRecurring = (cost: RecurringCost) =>
    mutate(() => api.post(`/finance/recurring-costs/${cost.id}/post`, { month }), `${cost.name} posted for ${monthLabel(month)}.`);

  const deactivateRecurring = (cost: RecurringCost) =>
    mutate(async () => {
      await api.delete(`/finance/recurring-costs/${cost.id}`);
      setRecurringCosts((current) => (current ?? []).map((c) => (c.id === cost.id ? { ...c, active: false } : c)));
    }, `${cost.name} removed from fixed costs.`);

  // ── Derived ──

  const { totals, opening, alert, foodCost } = view;
  const closingSub = view.unpaidFixedCosts ? `${signedInr(view.projectedClosing)} after fixed costs` : "end of month";

  return (
    <main className="inventory-page finance-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Finance · Kōsh Private Kitchen · Sadashivanagar</div>
          <h1>Cash Flow</h1>
        </div>
        <div className="header-actions">
          <a className="btn btn-ghost" href={`/api/v1/finance/months/${month}/export.csv`}>↓ CSV</a>
          <button className="btn btn-ghost" onClick={() => setModal({ kind: "recurring" })}>Fixed costs</button>
          <button className="btn btn-copper" onClick={() => setModal({ kind: "transaction", row: null })}>
            + Add Transaction
          </button>
        </div>
      </div>

      <div className="kpi-grid finance-kpis">
        <Kpi label="Opening balance" value={signedInr(opening.amount)} sub={OPENING_SOURCE[opening.source]} />
        <Kpi label="Total income" value={inr(totals.income)} sub={`subscriptions ${inr(totals.subscriptions)}`} />
        <Kpi label="Total expenses" value={inr(totals.expenses)} sub={`ingredients ${inr(totals.ingredients)}`} />
        <Kpi
          label="Net this month"
          value={`${totals.net > 0 ? "+" : ""}${signedInr(totals.net)}`}
          sub={totals.net >= 0 ? "surplus" : "deficit"}
          tone={totals.net < 0 ? "warn" : ""}
        />
        <Kpi label="Closing balance" value={signedInr(totals.closing)} sub={closingSub} tone={totals.closing < 0 ? "warn" : ""} />
        <Kpi
          label="Food cost"
          value={foodCost.percent === null ? "—" : `${foodCost.percent}%`}
          sub={`ingredients ÷ subscriptions · target ${foodCost.target}%`}
          tone={foodCost.level === "danger" ? "warn" : foodCost.level === "warn" ? "caution" : ""}
        />
      </div>

      <div className={`finance-alert finance-alert-${alert.level}`} role={alert.level === "ok" ? "status" : "alert"}>
        {alertText(view)}
      </div>

      {view.pendingPurchaseOrders.count > 0 && (
        <div className="finance-import">
          <span>
            <b>{view.pendingPurchaseOrders.count}</b> received purchase order
            {view.pendingPurchaseOrders.count === 1 ? "" : "s"} worth <b>{inr(view.pendingPurchaseOrders.total)}</b>{" "}
            {view.pendingPurchaseOrders.count === 1 ? "is" : "are"} not in the ledger yet
            <small>{view.pendingPurchaseOrders.orders.map((o) => o.vendorName).join(", ")}</small>
          </span>
          <button className="btn btn-copper" disabled={busy} onClick={importOrders}>
            Add as Ingredients expense
          </button>
        </div>
      )}

      <div className="finance-month-nav">
        <button className="icon-btn" onClick={() => load(view.previousMonth)} aria-label="Previous month" disabled={loading}>
          ◀
        </button>
        <h2>{monthLabel(month)}</h2>
        <button className="icon-btn" onClick={() => load(view.nextMonth)} aria-label="Next month" disabled={loading}>
          ▶
        </button>
        {!today.startsWith(month) && (
          <button className="finance-link" onClick={() => load(today.slice(0, 7))}>
            This month
          </button>
        )}
        <label className="finance-opening">
          <span>Opening balance ₹</span>
          <input
            className="add-field"
            type="number"
            step="0.01"
            placeholder={opening.source === "set" ? "" : String(opening.amount)}
            value={openingDraft ?? (opening.source === "set" ? String(opening.amount) : "")}
            onChange={(event) => setOpeningDraft(event.target.value)}
            onBlur={(event) => saveOpening(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            disabled={busy}
          />
          <small>{opening.source === "set" ? "set by hand · clear to carry forward" : "carried forward · type to override"}</small>
        </label>
      </div>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      <div className={`finance-layout${loading ? " finance-loading" : ""}`}>
        <div>
          <div className="inventory-tabs">
            {TABS.map(([id, label]) => (
              <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "ledger" && (
            <Ledger
              rows={view.rows}
              defaultDate={defaultDate}
              busy={busy}
              onEdit={(row) => setModal({ kind: "transaction", row })}
              onQuickAdd={quickAdd}
            />
          )}

          {tab === "weekly" && <WeeklyCards view={view} />}

          {tab === "charts" && (
            <>
              <section className="inventory-card">
                <div className="card-toolbar"><h2>Daily running balance</h2></div>
                <BalanceChart daily={view.daily} />
              </section>
              <section className="inventory-card">
                <div className="card-toolbar"><h2>Income vs expenses by week</h2></div>
                <WeeklyChart weeks={view.weeks} />
              </section>
            </>
          )}
        </div>

        <aside className="finance-side">
          <section className="inventory-card">
            <div className="card-toolbar"><h2>Month summary</h2></div>
            <div className="finance-sum">
              <Row label="Opening balance" value={signedInr(opening.amount)} />
              <Row label="+ Total income" value={inr(totals.income)} tone="in" />
              <Row label="− Total expenses" value={inr(totals.expenses)} tone="out" />
              <Row label="Net this month" value={`${totals.net > 0 ? "+" : ""}${signedInr(totals.net)}`} tone={totals.net < 0 ? "out" : "in"} />
              <Row label="Closing balance" value={signedInr(totals.closing)} tone={totals.closing < 0 ? "out" : "in"} total />
            </div>
          </section>

          <section className="inventory-card">
            <div className="card-toolbar"><h2>By category</h2></div>
            <div className="finance-sum">
              {view.byCategory.length === 0 && <p className="finance-muted">No transactions yet.</p>}
              {view.byCategory.map((item) => (
                <Row
                  key={`${item.direction}:${item.category}`}
                  label={
                    <>
                      <i className="finance-dot" style={{ background: colorFor(item.category) }} />
                      {item.category}
                    </>
                  }
                  value={`${item.direction === "IN" ? "+" : "−"}${inr(item.total)}`}
                  tone={item.direction === "IN" ? "in" : "out"}
                />
              ))}
            </div>
          </section>

          <section className="inventory-card">
            <div className="card-toolbar">
              <h2>Fixed costs</h2>
              <button className="btn btn-ghost btn-small" onClick={() => setModal({ kind: "recurring" })}>Manage</button>
            </div>
            <div className="finance-sum">
              {view.recurring.length === 0 && <p className="finance-muted">No fixed costs set. Add rent, salaries and the like under Manage.</p>}
              {view.recurring.map((cost) => (
                <Row
                  key={cost.id}
                  label={<>{cost.paid ? "✅" : "⏳"} {cost.name}</>}
                  value={`−${inr(cost.amount)}`}
                  tone={cost.paid ? "muted" : "out"}
                />
              ))}
              {view.recurring.length > 0 && (
                <Row
                  label="Still to pay"
                  value={view.unpaidFixedCosts ? `−${inr(view.unpaidFixedCosts)}` : "All paid"}
                  tone={view.unpaidFixedCosts ? "out" : "in"}
                  total
                />
              )}
            </div>
          </section>
        </aside>
      </div>

      {modal?.kind === "transaction" && (
        <TransactionModal
          row={modal.row}
          defaultDate={defaultDate}
          saving={busy}
          onClose={() => setModal(null)}
          onSave={(draft) => void saveTransaction(draft, modal.row)}
          onDelete={(row) => void deleteTransaction(row)}
        />
      )}

      {modal?.kind === "recurring" && (
        <RecurringModal
          costs={recurringCosts ?? []}
          status={view.recurring}
          month={month}
          busy={busy || !recurringCosts}
          onClose={() => {
            setModal(null);
            void refresh();
          }}
          onAdd={addRecurring}
          onPost={(cost) => void postRecurring(cost)}
          onDeactivate={(cost) => void deactivateRecurring(cost)}
        />
      )}
    </main>
  );
}

const OPENING_SOURCE = { set: "set by hand", carried: "carried from last month", none: "no earlier records" } as const;

function alertText(view: FinanceView) {
  const { closing } = view.totals;
  switch (view.alert.reason) {
    case "negative-closing":
      return (
        <>
          ⚠ <strong>Negative closing balance: {inr(closing)} short.</strong> Chase pending subscription payments or defer a purchase before month-end.
        </>
      );
    case "fixed-costs-exceed-balance":
      return (
        <>
          ⚠ <strong>Unpaid fixed costs ({inr(view.unpaidFixedCosts)}) would take the balance to {signedInr(view.projectedClosing)}.</strong> Plan when rent and salaries go out.
        </>
      );
    case "low-balance":
      return <>⚡ Balance after fixed costs is {signedInr(view.projectedClosing)} — under ₹1L. Watch cash closely this month.</>;
    default:
      return (
        <>
          ✓ Cash position looks healthy. Closing {inr(closing)}
          {view.unpaidFixedCosts ? `, ${inr(view.projectedClosing)} after remaining fixed costs` : ""}.
        </>
      );
  }
}

function Row({
  label,
  value,
  tone,
  total,
}: {
  label: React.ReactNode;
  value: string;
  tone?: "in" | "out" | "muted";
  total?: boolean;
}) {
  const className = tone === "in" ? "money-in" : tone === "out" ? "money-out" : tone === "muted" ? "finance-muted" : "";
  return (
    <div className={`finance-sum-row${total ? " total" : ""}`}>
      <span>{label}</span>
      <b className={className}>{value}</b>
    </div>
  );
}

function WeeklyCards({ view }: { view: FinanceView }) {
  const max = Math.max(1, ...view.weeks.flatMap((w) => [w.income, w.expenses]));
  const short = new Date(`${view.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });
  return (
    <div className="finance-weeks">
      {view.weeks.map((week) => (
        <section key={week.start} className="inventory-card finance-week">
          <div className="finance-week-head">
            <h3>
              {week.start}–{week.end} {short}
            </h3>
            <b className={week.net < 0 ? "money-out" : "money-in"}>
              {week.net > 0 ? "+" : ""}
              {signedInr(week.net)}
            </b>
          </div>
          <p>
            {week.count} transaction{week.count === 1 ? "" : "s"} · In {inr(week.income)} · Out {inr(week.expenses)} · Balance after{" "}
            {signedInr(week.closing)}
          </p>
          <div className="finance-week-bars">
            <div>
              <small>Income</small>
              <div className="finance-track"><i className="bar-fill-in" style={{ width: `${(week.income / max) * 100}%` }} /></div>
            </div>
            <div>
              <small>Expenses</small>
              <div className="finance-track"><i className="bar-fill-out" style={{ width: `${(week.expenses / max) * 100}%` }} /></div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
