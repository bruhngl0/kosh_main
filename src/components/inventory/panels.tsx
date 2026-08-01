"use client";

import { useState } from "react";
import { inr, type CostSummary, type Ingredient, type Vendor, type VesselKit } from "./types";

/** Par levels, vendors, vessels, and the cost/P&L view. */

export function ParLevelsPanel({
  ingredients,
  onPatch,
  onReceive,
}: {
  ingredients: Ingredient[];
  onPatch: (item: Ingredient, patch: Record<string, unknown>) => Promise<void>;
  onReceive: (item: Ingredient) => void;
}) {
  // Items needing attention first: out of stock, then below par, then the rest.
  const rank = { "out-of-stock": 0, "below-par": 1, ok: 2 } as const;
  const sorted = [...ingredients].sort(
    (a, b) => rank[a.parStatus] - rank[b.parStatus] || a.name.localeCompare(b.name),
  );

  return (
    <section className="inventory-card inventory-table-card">
      <div className="card-toolbar">
        <h2>Standing Par Levels — Main Kitchen</h2>
        <span>Par is the minimum stock to hold. Reorder when current stock falls below it.</span>
      </div>
      <div className="table-scroll">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Current stock</th>
              <th>Par level</th>
              <th>To reorder</th>
              <th>Status</th>
              <th>Vendor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.quantity} {item.defaultUnit}</td>
                <td>
                  <input
                    className="inline-input"
                    type="number"
                    min="0"
                    step="0.001"
                    defaultValue={item.parLevel}
                    onBlur={(event) => {
                      const parLevel = Number(event.target.value);
                      if (Number.isFinite(parLevel) && parLevel >= 0 && parLevel !== item.parLevel) {
                        void onPatch(item, { parLevel });
                      }
                    }}
                  />{" "}
                  {item.defaultUnit}
                </td>
                <td>{item.reorderQuantity > 0 ? `${item.reorderQuantity} ${item.defaultUnit}` : "—"}</td>
                <td>
                  <span className={item.parStatus === "ok" ? "stock-ok" : "stock-low"}>
                    {item.parStatus === "out-of-stock" ? "Out of stock" : item.parStatus === "below-par" ? "Below par" : "OK"}
                  </span>
                </td>
                <td>{item.vendor?.name ?? "—"}</td>
                <td>
                  {item.parStatus !== "ok" && (
                    <button className="btn btn-ghost btn-small" onClick={() => onReceive(item)}>Receive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inventory-note">
        ⚡ Items below par should be ordered today. Par edits save on blur; stock changes only through a recorded movement.
      </div>
    </section>
  );
}

export function VendorsPanel({
  vendors,
  onAdd,
  onEdit,
}: {
  vendors: Vendor[];
  onAdd: () => void;
  onEdit: (vendor: Vendor) => void;
}) {
  return (
    <section className="inventory-card inventory-table-card">
      <div className="card-toolbar">
        <h2>Vendor & Supplier Directory</h2>
        <button className="btn btn-ghost btn-small" onClick={onAdd}>+ Add Vendor</button>
      </div>
      <div className="table-scroll">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Category</th>
              <th>Contact</th>
              <th>WhatsApp</th>
              <th>MOQ / Lead</th>
              <th>Area</th>
              <th>Payment</th>
              <th>Items</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vendors.length === 0 && (
              <tr><td colSpan={9}><div className="empty">No vendors yet.</div></td></tr>
            )}
            {vendors.map((vendor) => (
              <tr key={vendor.id}>
                <td><strong>{vendor.name}</strong></td>
                <td>{vendor.category ?? "—"}</td>
                <td>{vendor.contact ?? "—"}</td>
                <td>
                  {vendor.whatsappUrl ? (
                    <a className="btn btn-green btn-small" href={vendor.whatsappUrl} target="_blank" rel="noreferrer">
                      📱 {vendor.whatsapp}
                    </a>
                  ) : (
                    vendor.phone ?? "—"
                  )}
                </td>
                <td>{vendor.minimumOrder ?? "—"} · {vendor.leadTime ?? "—"}</td>
                <td>{vendor.area ?? "—"}</td>
                <td>{vendor.paymentTerms ?? "—"}</td>
                <td>{vendor.counts.ingredients}</td>
                <td>
                  <button className="icon-btn" title="Edit" onClick={() => onEdit(vendor)}>✏️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function VesselsPanel({
  kits,
  consumables,
  onAdd,
  onUpdate,
}: {
  kits: VesselKit[];
  consumables: Ingredient[];
  onAdd: () => void;
  onUpdate: (kit: VesselKit, patch: Record<string, unknown>) => Promise<void>;
}) {
  const overdue = kits.filter((kit) => kit.sanitisationOverdue).length;

  return (
    <>
      <section className="inventory-card">
        <div className="card-toolbar">
          <h2>Subscriber Vessel Kit Registry</h2>
          <button className="btn btn-ghost btn-small" onClick={onAdd}>+ Register Kit</button>
        </div>
        <p className="inventory-note">
          Each subscriber holds two sets (Set A + Set B) so one is always in circulation.
          {overdue > 0 && <strong> {overdue} kit(s) overdue for sanitisation.</strong>}
        </p>
        <div className="vessel-grid">
          {kits.length === 0 && <div className="cost-summary">No vessel kits registered yet.</div>}
          {kits.map((kit) => (
            <article
              key={kit.id}
              className={`vessel-card ${kit.status === "needs-replace" ? "needs-replace" : ""}`}
            >
              <strong>{kit.subscriberName}</strong>
              <span>{kit.typeLabel} · {kit.sets} sets</span>
              <b className={`vessel-status ${kit.status}`}>{kit.status.replace("-", " ")}</b>
              <small>
                Issued {kit.issuedAt ?? "—"} · Sanitised {kit.sanitisedAt ?? "—"}
                {kit.sanitisationOverdue && <em className="stock-low"> · overdue</em>}
              </small>
              {kit.notes && <p>{kit.notes}</p>}
              <div className="vessel-actions">
                <button
                  className="btn btn-ghost btn-small"
                  onClick={() => void onUpdate(kit, { sanitisedAt: new Date().toISOString().slice(0, 10) })}
                >
                  Mark sanitised
                </button>
                {kit.status !== "needs-replace" && (
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => void onUpdate(kit, { status: "needs-replace" })}
                  >
                    Flag replacement
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="inventory-card inventory-table-card">
        <div className="card-toolbar"><h2>Vessel Consumables Stock</h2></div>
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr><th>Item</th><th>Stock</th><th>Par</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {consumables.length === 0 && (
                <tr><td colSpan={5}><div className="empty">No vessel consumables registered.</div></td></tr>
              )}
              {consumables.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td>{item.quantity} {item.defaultUnit}</td>
                  <td>{item.parLevel} {item.defaultUnit}</td>
                  <td>
                    <span className={item.parStatus === "ok" ? "stock-ok" : "stock-low"}>
                      {item.parStatus === "ok" ? "OK" : "Needed"}
                    </span>
                  </td>
                  <td>{item.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/**
 * Cost and P&L. Restores cost-by-vendor, cost-by-frequency, and the P&L block
 * from Kosh_Inventory.html:872 that the React rewrite had dropped.
 */
export function CostPanel({ summary, onRefresh }: { summary: CostSummary | null; onRefresh: () => void }) {
  const [pending, setPending] = useState(false);

  if (!summary) {
    return (
      <section className="inventory-card">
        <div className="card-toolbar"><h2>Cost Summary</h2></div>
        <div className="empty">
          <button
            className="btn btn-copper btn-small"
            disabled={pending}
            onClick={() => { setPending(true); onRefresh(); }}
          >
            {pending ? "Loading…" : "Load cost summary"}
          </button>
        </div>
      </section>
    );
  }

  const table = (title: string, rows: { key: string; cost: number; share: number }[]) => (
    <section className="inventory-card inventory-table-card">
      <div className="card-toolbar"><h2>{title}</h2></div>
      <table className="inventory-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{inr(row.cost)}</td>
              <td className="cell-muted">{row.share}%</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td>{inr(summary.totalSpend)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </section>
  );

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Ingredient spend" value={inr(summary.totalSpend)} sub={summary.basis === "cycle-week" ? "this production week" : "standing reference"} />
        <Kpi label="Est. revenue" value={inr(summary.totalRevenue)} sub={`${summary.subscriberCount} subscribers`} />
        <Kpi
          label="Food cost"
          value={`${summary.foodCostPercent}%`}
          sub={`target ${summary.targetPercent}%`}
          tone={summary.withinTarget ? "" : "warn"}
        />
        <Kpi label="Per subscriber" value={inr(summary.costPerSubscriber)} sub="per week" />
        <Kpi label="Per meal" value={inr(summary.costPerMeal)} sub="ingredient cost" />
        <Kpi label="Ingredient margin" value={inr(summary.ingredientMargin)} sub="revenue − ingredients" />
      </div>

      <div className="cost-grid">
        {table("By category", summary.byCategory)}
        {table("By vendor", summary.byVendor)}
        {table("By order frequency", summary.byFrequency)}
      </div>

      <section className="inventory-card">
        <div className="card-toolbar"><h2>Subscription mix</h2></div>
        <table className="inventory-table">
          <thead><tr><th>Plan</th><th>Daily rate</th><th>Subscribers</th></tr></thead>
          <tbody>
            {summary.enrolments.map((plan) => (
              <tr key={plan.planName}>
                <td>{plan.planName}</td>
                <td>{inr(plan.dailyRate)}</td>
                <td>{plan.subscriberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inventory-note">
          ⚠ Ingredient cost only. Excludes chef salary, delivery, vessel operations, and fixed overheads.
        </div>
      </section>
    </>
  );
}

export function Kpi({ label, value, sub, tone = "" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{sub}</span>
    </div>
  );
}
