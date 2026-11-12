"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import { Kpi } from "@/components/inventory/panels";
import type { listSubscribers, SubscriberView } from "@/modules/subscribers";
import type { SubscriberStatus } from "@/shared/schemas/subscribers";
import { STATUS_LABELS, type Plan } from "./labels";
import { SubscriberModal, type SubscriberDraft } from "./subscriber-modal";

export type Roster = Awaited<ReturnType<typeof listSubscribers>>;

const FILTERS: ["" | SubscriberStatus, string][] = [
  ["", "All"],
  ["onboarding", "Onboarding"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["ended", "Ended"],
];

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function SubscribersDashboard({ initialRoster, plans }: { initialRoster: Roster; plans: Plan[] }) {
  const [roster, setRoster] = useState(initialRoster);
  const [filter, setFilter] = useState<"" | SubscriberStatus>("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{ subscriber: SubscriberView | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { feedback, succeed, fail, clear } = useFeedback();
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const next = await api.get<Roster>("/subscribers");
      if (mine === ticket.current) setRoster(next);
    } catch (error) {
      fail(errorMessage(error));
    }
  }, [fail]);

  // Filtering is client-side: the roster is tens of rows, not thousands.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.subscribers.filter(
      (s) =>
        (!filter || s.status === filter) &&
        (!q ||
          [s.name, s.phone, s.email, s.onboardingRef, s.address].some((field) => field?.toLowerCase().includes(q))),
    );
  }, [roster, filter, query]);

  async function patch(subscriber: SubscriberView, change: Partial<SubscriberDraft>, message: string) {
    setBusyId(subscriber.id);
    try {
      await api.patch(`/subscribers/${subscriber.id}`, change);
      await reload();
      succeed(message);
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function save(draft: SubscriberDraft, existing: SubscriberView | null) {
    setSaving(true);
    try {
      if (existing) await api.patch(`/subscribers/${existing.id}`, draft);
      else await api.post("/subscribers", draft);
      await reload();
      succeed(existing ? `${draft.name} updated.` : `${draft.name} added.`);
      setModal(null);
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const { summary } = roster;
  const fromOnboarding = roster.subscribers.filter((s) => s.source === "onboarding").length;

  return (
    <main className="inventory-page subscribers-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Subscribers · Kōsh Private Kitchen · Sadashivanagar</div>
          <h1>Roster</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-copper" onClick={() => setModal({ subscriber: null })}>
            + Subscriber
          </button>
        </div>
      </div>

      <div className="kpi-grid subscribers-kpis">
        <Kpi label="Active" value={`${summary.active} / ${summary.capacity}`} sub="receiving meals" />
        <Kpi label="Onboarding" value={String(summary.onboarding)} sub="confirmed, not yet delivering" />
        <Kpi label="Paused" value={String(summary.paused)} sub="seat kept" />
        <Kpi
          label="Seats left"
          value={String(summary.seatsLeft)}
          sub={summary.overCapacity ? `over capacity by ${summary.seatsTaken - summary.capacity}` : `${summary.seatsTaken} of ${summary.capacity} taken`}
          tone={summary.overCapacity ? "warn" : ""}
        />
        <Kpi label="From onboarding" value={String(fromOnboarding)} sub="synced from the apply form" />
      </div>

      <div className="inventory-tabs">
        {FILTERS.map(([id, label]) => (
          <button key={id || "all"} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
            {label}
            <span className="subscribers-count">{id ? summary[id] : summary.total}</span>
          </button>
        ))}
      </div>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      <section className="inventory-card">
        <div className="card-toolbar">
          <h2>
            {visible.length} subscriber{visible.length === 1 ? "" : "s"}
          </h2>
          <input
            className="add-field subscribers-search"
            type="search"
            placeholder="Search name, phone, email, KSH ref…"
            aria-label="Search subscribers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="table-scroll">
          <table className="inventory-table subscribers-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Diet &amp; allergies</th>
                <th>Contact</th>
                <th>Delivery</th>
                <th>Kits</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="subscribers-empty">
                    {roster.subscribers.length
                      ? "Nobody matches this filter."
                      : "No subscribers yet. Confirmed applicants from the onboarding app will appear here."}
                  </td>
                </tr>
              )}
              {visible.map((s) => (
                <tr key={s.id} className={busyId === s.id ? "subscribers-busy" : ""}>
                  <td className="subscribers-name">
                    <button className="subscribers-link" onClick={() => setModal({ subscriber: s })}>
                      {s.name}
                    </button>
                    <small>
                      {s.onboardingRef && <span className="subscribers-ref">{s.onboardingRef}</span>}
                      {s.startDate ? `since ${s.startDate}` : s.source === "onboarding" ? "from onboarding" : ""}
                    </small>
                  </td>
                  <td>
                    <select
                      className={`add-field status-select status-${s.status}`}
                      aria-label={`Status for ${s.name}`}
                      value={s.status}
                      disabled={busyId === s.id}
                      onChange={(event) => {
                        const status = event.target.value as SubscriberStatus;
                        void patch(s, { status }, `${s.name} is now ${STATUS_LABELS[status].toLowerCase()}.`);
                      }}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="add-field"
                      aria-label={`Plan for ${s.name}`}
                      value={s.plan?.id ?? ""}
                      disabled={busyId === s.id}
                      onChange={(event) => {
                        const planId = event.target.value || null;
                        const name = plans.find((p) => p.id === planId)?.name;
                        void patch(s, { planId }, name ? `${s.name} moved to ${name}.` : `${s.name}'s plan cleared.`);
                      }}
                    >
                      <option value="">— No plan —</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} · {inr(plan.dailyRate)}/day
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="subscribers-diet">
                    {s.diet ?? <span className="subscribers-muted">—</span>}
                    {s.allergies.length > 0 && (
                      <div className="subscribers-allergies">
                        {s.allergies.map((a) => (
                          <span key={a} className="allergen">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="subscribers-contact">
                    {s.phone ? (
                      s.whatsapp ? (
                        <a href={`https://wa.me/${s.whatsapp}`} target="_blank" rel="noreferrer">
                          {s.phone}
                        </a>
                      ) : (
                        s.phone
                      )
                    ) : (
                      <span className="subscribers-muted">—</span>
                    )}
                    {s.email && <small>{s.email}</small>}
                  </td>
                  <td className="subscribers-delivery">
                    {s.deliverySlot && <b>{s.deliverySlot}</b>}
                    <small>{s.landmark ?? s.address?.split(",")[0] ?? ""}</small>
                  </td>
                  <td>{s.kitCount}</td>
                  <td>
                    <button className="icon-btn" onClick={() => setModal({ subscriber: s })} aria-label={`Open ${s.name}`}>
                      ✎
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <SubscriberModal
          subscriber={modal.subscriber}
          plans={plans}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(draft) => void save(draft, modal.subscriber)}
        />
      )}
    </main>
  );
}
