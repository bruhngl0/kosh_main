"use client";

import { useState } from "react";
import type { CashDirection } from "@/shared/schemas/finance";
import { ALL_CATEGORIES } from "./categories";
import { categoriesFor, colorFor, inr, shortDate, signedInr, type LedgerRow } from "./types";

export type QuickAddInput = {
  date: string;
  description: string;
  direction: CashDirection;
  category: string;
  amount: number;
};

export function Ledger({
  rows,
  defaultDate,
  busy,
  onEdit,
  onQuickAdd,
}: {
  rows: LedgerRow[];
  defaultDate: string;
  busy: boolean;
  onEdit: (row: LedgerRow) => void;
  onQuickAdd: (input: QuickAddInput) => Promise<boolean>;
}) {
  const [typeFilter, setTypeFilter] = useState<"" | CashDirection>("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const visible = rows.filter(
    (row) => (!typeFilter || row.direction === typeFilter) && (!categoryFilter || row.category === categoryFilter),
  );

  return (
    <section className="inventory-card finance-ledger">
      <div className="card-toolbar">
        <h2>
          Transactions ({visible.length}
          {visible.length !== rows.length ? ` of ${rows.length}` : ""})
        </h2>
        <div className="finance-filters">
          <select
            className="add-field"
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "" | CashDirection)}
          >
            <option value="">All types</option>
            <option value="IN">Income only</option>
            <option value="OUT">Expenses only</option>
          </select>
          <select
            className="add-field"
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {ALL_CATEGORIES.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-scroll">
        <table className="inventory-table finance-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="num">In (₹)</th>
              <th className="num">Out (₹)</th>
              <th className="num">Balance</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="finance-empty">
                  {rows.length ? "Nothing matches these filters." : "No transactions this month yet — add one below."}
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr key={row.id}>
                <td className="finance-date">{shortDate(row.date)}</td>
                <td className="finance-desc">
                  <strong>{row.description}</strong>
                  {(row.notes || row.purchaseOrderId || row.recurringCostId) && (
                    <small>
                      {row.purchaseOrderId ? "From purchase order" : row.recurringCostId ? "Fixed cost" : ""}
                      {row.notes && (row.purchaseOrderId || row.recurringCostId) ? " · " : ""}
                      {row.notes && row.notes !== "Fixed cost" ? row.notes : ""}
                    </small>
                  )}
                </td>
                <td>
                  <span
                    className="finance-badge"
                    style={{ color: colorFor(row.category), background: `${colorFor(row.category)}1F` }}
                  >
                    {row.category}
                  </span>
                </td>
                <td className="num money-in">{row.direction === "IN" ? inr(row.amount) : "—"}</td>
                <td className="num money-out">{row.direction === "OUT" ? inr(row.amount) : "—"}</td>
                <td className={`num finance-balance ${row.balance < 0 ? "money-out" : "money-in"}`}>
                  {signedInr(row.balance)}
                </td>
                <td>
                  <button className="icon-btn" onClick={() => onEdit(row)} aria-label={`Edit ${row.description}`}>
                    ✎
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <QuickAdd key={defaultDate} defaultDate={defaultDate} busy={busy} onAdd={onQuickAdd} />
    </section>
  );
}

function QuickAdd({
  defaultDate,
  busy,
  onAdd,
}: {
  defaultDate: string;
  busy: boolean;
  onAdd: (input: QuickAddInput) => Promise<boolean>;
}) {
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState<CashDirection>("OUT");
  const [category, setCategory] = useState<string>(categoriesFor("OUT")[0]);
  const [amount, setAmount] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const added = await onAdd({ date, description, direction, category, amount: Number(amount) });
    if (added) {
      setDescription("");
      setAmount("");
    }
  }

  return (
    <form className="finance-quick-add" onSubmit={submit}>
      <input
        className="add-field"
        type="date"
        aria-label="Date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        required
      />
      <input
        className="add-field finance-quick-desc"
        placeholder="Description *"
        aria-label="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        required
      />
      <select
        className="add-field"
        aria-label="Type"
        value={direction}
        onChange={(event) => {
          const next = event.target.value as CashDirection;
          setDirection(next);
          setCategory(categoriesFor(next)[0]);
        }}
      >
        <option value="IN">+ Income</option>
        <option value="OUT">− Expense</option>
      </select>
      <select
        className="add-field"
        aria-label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value)}
      >
        {categoriesFor(direction).map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <input
        className="add-field finance-quick-amount"
        type="number"
        min="0.01"
        step="0.01"
        placeholder="Amount ₹ *"
        aria-label="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        required
      />
      <button className="btn btn-copper" type="submit" disabled={busy}>
        Add
      </button>
    </form>
  );
}
