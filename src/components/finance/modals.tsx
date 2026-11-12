"use client";

import { useEffect, useState } from "react";
import { Field, Modal } from "@/components/ui/modal";
import { CASH_OUT_CATEGORIES } from "@/shared/finance-categories";
import type { CashDirection } from "@/shared/schemas/finance";
import { categoriesFor, inr, type LedgerRow, type RecurringCost, type RecurringRow } from "./types";

export type TransactionDraft = {
  date: string;
  direction: CashDirection;
  category: string;
  description: string;
  amount: number;
  notes: string | null;
};

export function TransactionModal({
  row,
  defaultDate,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  row: LedgerRow | null;
  defaultDate: string;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: TransactionDraft) => void;
  onDelete: (row: LedgerRow) => void;
}) {
  const [direction, setDirection] = useState<CashDirection>(row?.direction ?? "OUT");
  const [category, setCategory] = useState<string>(row?.category ?? categoriesFor(row?.direction ?? "OUT")[0]);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <Modal
      title={row ? "Edit Transaction" : "Add Transaction"}
      subtitle={row?.purchaseOrderId ? "Imported from a received purchase order." : undefined}
      onClose={onClose}
      saving={saving}
      onSubmit={(form) => {
        const data = new FormData(form);
        onSave({
          date: String(data.get("date")),
          direction,
          category,
          description: String(data.get("description")),
          amount: Number(data.get("amount")),
          notes: String(data.get("notes") ?? "") || null,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Date *" name="date" type="date" defaultValue={row?.date ?? defaultDate} required />
        <Field
          label="Type"
          name="direction"
          as="select"
          value={direction}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            const next = event.target.value as CashDirection;
            setDirection(next);
            setCategory(categoriesFor(next)[0]);
          }}
        >
          <option value="IN">Income</option>
          <option value="OUT">Expense</option>
        </Field>
        <Field
          label="Description *"
          name="description"
          full
          defaultValue={row?.description ?? ""}
          placeholder="e.g. Subscriptions — week 2 (Full Day)"
          maxLength={200}
          required
          autoFocus
        />
        <Field
          label="Amount (₹) *"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          defaultValue={row?.amount ?? ""}
          required
        />
        <Field
          label="Category"
          name="category"
          as="select"
          value={category}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value)}
        >
          {categoriesFor(direction).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </Field>
        <Field label="Notes" name="notes" full defaultValue={row?.notes ?? ""} placeholder="Optional" maxLength={500} />
      </div>
      {row && (
        <div className="finance-delete-row">
          <button
            type="button"
            className="btn btn-ghost finance-delete"
            disabled={saving}
            onClick={() => (armed ? onDelete(row) : setArmed(true))}
          >
            {armed ? "Click again to delete" : "Delete transaction"}
          </button>
        </div>
      )}
    </Modal>
  );
}

export function RecurringModal({
  costs,
  status,
  month,
  busy,
  onClose,
  onAdd,
  onPost,
  onDeactivate,
}: {
  costs: RecurringCost[];
  status: RecurringRow[];
  month: string;
  busy: boolean;
  onClose: () => void;
  onAdd: (input: { name: string; category: string; amount: number }) => Promise<boolean>;
  onPost: (cost: RecurringCost) => void;
  onDeactivate: (cost: RecurringCost) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("Rent");
  const [amount, setAmount] = useState("");
  const paid = new Set(status.filter((row) => row.paid).map((row) => row.id));
  const active = costs.filter((cost) => cost.active);

  async function add() {
    if (await onAdd({ name, category, amount: Number(amount) })) {
      setName("");
      setAmount("");
    }
  }

  return (
    <Modal
      title="Fixed Monthly Costs"
      subtitle="Reminders only — nothing is posted automatically. “Post” logs the payment for this month."
      onClose={onClose}
    >
      <div className="finance-recurring-edit">
        {active.length === 0 && <p className="finance-muted">No fixed costs yet.</p>}
        {active.map((cost) => (
          <div key={cost.id} className="finance-recurring-row">
            <span>
              {cost.name}
              <small>{cost.category}</small>
            </span>
            <b>−{inr(cost.amount)}</b>
            {paid.has(cost.id) ? (
              <em className="money-in">Paid</em>
            ) : (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => onPost(cost)} title={`Post for ${month}`}>
                Post
              </button>
            )}
            <button type="button" className="icon-btn danger" disabled={busy} onClick={() => onDeactivate(cost)} aria-label={`Remove ${cost.name}`}>
              ✕
            </button>
          </div>
        ))}
      </div>
      {/* Not a <form>: Modal already renders one, and forms cannot nest. */}
      <div
        className="finance-recurring-add"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
        }}
      >
        <input className="add-field" placeholder="Cost name" aria-label="Cost name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="add-field" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CASH_OUT_CATEGORIES.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <input
          className="add-field"
          type="number"
          min="1"
          placeholder="₹"
          aria-label="Monthly amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button type="button" className="btn btn-copper" disabled={busy} onClick={() => void add()}>
          + Add
        </button>
      </div>
    </Modal>
  );
}
