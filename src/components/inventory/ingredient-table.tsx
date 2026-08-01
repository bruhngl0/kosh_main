"use client";

import { useState } from "react";
import { CATEGORIES, FREQUENCIES, STATUSES, categoryLabel, inr, type Ingredient } from "./types";

/**
 * The ingredient master.
 *
 * Every cell here was previously `readOnly`, the status dropdown was wired to
 * `onChange={() => undefined}`, and the edit and delete buttons had no handler
 * at all — the table looked editable and silently was not. Each field now
 * commits on blur.
 */

type SortKey = "name" | "category" | "quantityNeeded" | "unitCost" | "standingLineCost" | "quantity";

export function IngredientTable({
  ingredients,
  filters,
  onFilterChange,
  onPatch,
  onReceive,
  onArchive,
  onAdd,
  busyId,
}: {
  ingredients: Ingredient[];
  filters: { search: string; category: string; status: string; frequency: string };
  onFilterChange: (patch: Partial<typeof filters>) => void;
  onPatch: (item: Ingredient, patch: Record<string, unknown>) => Promise<void>;
  onReceive: (item: Ingredient) => void;
  onArchive: (item: Ingredient) => void;
  onAdd: () => void;
  busyId: string | null;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "name", direction: 1 });

  const sorted = [...ingredients].sort((a, b) => {
    const left = a[sort.key] ?? "";
    const right = b[sort.key] ?? "";
    if (typeof left === "number" && typeof right === "number") return (left - right) * sort.direction;
    return String(left).localeCompare(String(right)) * sort.direction;
  });

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 },
    );

  const heading = (key: SortKey, label: string) => (
    <th>
      <button type="button" className="sort-header" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key && <span aria-hidden> {sort.direction === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <>
      <div className="category-pills">
        {CATEGORIES.map(([id, label]) => {
          const count = id === "all" ? ingredients.length : ingredients.filter((item) => item.category === id).length;
          return (
            <button
              key={id}
              className={filters.category === id ? "active" : ""}
              onClick={() => onFilterChange({ category: id })}
            >
              {label} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <section className="inventory-card inventory-table-card">
        <div className="card-toolbar">
          <h2>{categoryLabel(filters.category)} ({sorted.length})</h2>
          <div className="inventory-filters">
            <input
              className="search"
              placeholder="Search ingredient or vendor…"
              value={filters.search}
              onChange={(event) => onFilterChange({ search: event.target.value })}
            />
            <select
              className="search"
              value={filters.status}
              onChange={(event) => onFilterChange({ status: event.target.value })}
            >
              <option value="">All statuses</option>
              {STATUSES.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <select
              className="search"
              value={filters.frequency}
              onChange={(event) => onFilterChange({ frequency: event.target.value })}
            >
              {FREQUENCIES.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-scroll">
          <table className="inventory-table inventory-reference-table">
            <thead>
              <tr>
                {heading("name", "Ingredient")}
                {heading("category", "Category")}
                <th>Frequency</th>
                <th>Vendor</th>
                {heading("quantityNeeded", "Qty needed")}
                <th>Unit</th>
                {heading("unitCost", "Unit cost")}
                {heading("standingLineCost", "Total cost")}
                {heading("quantity", "Stock")}
                <th>Status</th>
                <th>Notes / spec</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={12}>
                    <div className="empty">No ingredients match these filters.</div>
                  </td>
                </tr>
              )}
              {sorted.map((item) => (
                <tr key={item.id} className={busyId === item.id ? "row-busy" : undefined}>
                  <td><strong>{item.name}</strong></td>
                  <td>
                    <span className={`category-badge category-${item.category}`}>
                      {categoryLabel(item.category)}
                    </span>
                  </td>
                  <td>
                    <select
                      className="add-field"
                      value={item.defaultFrequency}
                      onChange={(event) => void onPatch(item, { defaultFrequency: event.target.value })}
                    >
                      {FREQUENCIES.filter(([id]) => id).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-truncate" title={item.vendor?.name ?? "—"}>{item.vendor?.name ?? "—"}</td>
                  <td>
                    <NumberCell
                      value={item.quantityNeeded}
                      onCommit={(value) => onPatch(item, { quantityNeeded: value })}
                    />
                  </td>
                  <td>{item.defaultUnit}</td>
                  <td>{item.unitCost === null ? "—" : inr(item.unitCost)}</td>
                  <td className="cell-cost">
                    {item.standingLineCost ? inr(item.standingLineCost) : "—"}
                  </td>
                  <td>
                    <span className={item.parStatus === "ok" ? "stock-ok" : "stock-low"}>
                      {item.quantity} {item.defaultUnit}
                    </span>
                  </td>
                  <td>
                    <select
                      className="add-field"
                      value={item.inventoryStatus}
                      onChange={(event) => void onPatch(item, { status: event.target.value })}
                    >
                      {STATUSES.map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <TextCell
                      value={item.notes ?? ""}
                      placeholder="spec / notes…"
                      onCommit={(value) => onPatch(item, { notes: value })}
                    />
                  </td>
                  <td>
                    <div className="actions">
                      <button className="icon-btn" title="Receive stock" onClick={() => onReceive(item)}>📦</button>
                      <button className="icon-btn danger" title="Archive" onClick={() => onArchive(item)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="add-row-wrap">
          <button className="btn btn-copper btn-small" onClick={onAdd}>+ Add ingredient</button>
        </div>
      </section>
    </>
  );
}

/** Commits on blur or Enter, and reverts on Escape. */
function NumberCell({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  return (
    <input
      className="editable"
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(String(value));
      }}
      onBlur={() => {
        const parsed = Number(draft);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setDraft(String(value));
          return;
        }
        if (parsed !== value) onCommit(parsed);
      }}
    />
  );
}

function TextCell({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <input
      className="editable-text editable-wide"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(value);
      }}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}
