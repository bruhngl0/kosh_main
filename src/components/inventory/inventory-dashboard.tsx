"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import { IngredientTable } from "./ingredient-table";
import { CostPanel, Kpi, ParLevelsPanel, VendorsPanel, VesselsPanel } from "./panels";
import { OutreachPanel } from "./outreach-panel";
import { IngredientModal, MovementModal, ReceiveOrderModal, VendorModal, VesselModal } from "./modals";
import {
  inr,
  type CostSummary,
  type GenerationResult,
  type Ingredient,
  type PurchaseOrder,
  type Vendor,
  type VesselKit,
} from "./types";

type Tab = "items" | "par" | "vessels" | "vendors" | "outreach" | "cost";

const TABS: [Tab, string][] = [
  ["items", "🧺 Ingredient List"],
  ["par", "📊 Par Levels"],
  ["vessels", "⬡ Vessel Kits"],
  ["vendors", "🏪 Vendors"],
  ["outreach", "📤 Outreach"],
  ["cost", "₹ Cost Summary"],
];

type Modal =
  | { kind: "ingredient" }
  | { kind: "vendor"; vendor?: Vendor }
  | { kind: "vessel" }
  | { kind: "movement"; ingredient: Ingredient }
  | { kind: "receive"; order: PurchaseOrder }
  | null;

export function InventoryDashboard({
  initialIngredients,
  initialVendors,
  initialKits,
  cycle,
}: {
  initialIngredients: Ingredient[];
  initialVendors: Vendor[];
  initialKits: VesselKit[];
  cycle: { id: string; name: string; subscriberCount: number; weekCount: number; chefName: string | null; foodCostTargetPercent: number | null } | null;
}) {
  const [ingredients, setIngredients] = useState(initialIngredients);
  const [vendors, setVendors] = useState(initialVendors);
  const [kits, setKits] = useState(initialKits);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [generation, setGeneration] = useState<GenerationResult | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);

  const [tab, setTab] = useState<Tab>("items");
  const [week, setWeek] = useState(1);
  const [modal, setModal] = useState<Modal>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: "", category: "all", status: "", frequency: "" });

  const { feedback, succeed, fail, clear } = useFeedback();

  const refreshIngredients = useCallback(async () => {
    setIngredients(await api.get<Ingredient[]>("/ingredients?managedOnly=true"));
  }, []);

  const loadOrders = useCallback(async () => {
    if (!cycle) return;
    try {
      setOrders(await api.get<PurchaseOrder[]>(`/purchase-orders?cycleId=${cycle.id}&weekNumber=${week}`));
    } catch (error) {
      fail(errorMessage(error));
    }
  }, [cycle, week, fail]);

  const loadCost = useCallback(async () => {
    try {
      const query = cycle ? `?cycleId=${cycle.id}&weekNumber=${week}` : "";
      setCost(await api.get<CostSummary>(`/cost-summary${query}`));
    } catch (error) {
      fail(errorMessage(error));
    }
  }, [cycle, week, fail]);

  useEffect(() => {
    if (tab === "outreach") void loadOrders();
    if (tab === "cost") void loadCost();
  }, [tab, loadOrders, loadCost]);

  const filtered = useMemo(
    () =>
      ingredients.filter(
        (item) =>
          (filters.category === "all" || item.category === filters.category) &&
          (!filters.status || item.inventoryStatus === filters.status) &&
          (!filters.frequency || item.defaultFrequency === filters.frequency) &&
          (!filters.search ||
            `${item.name} ${item.vendor?.name ?? ""} ${item.notes ?? ""}`
              .toLowerCase()
              .includes(filters.search.toLowerCase())),
      ),
    [ingredients, filters],
  );

  const belowPar = ingredients.filter((item) => item.parStatus !== "ok");
  const projectedSpend = belowPar.reduce((sum, item) => sum + item.reorderQuantity * (item.unitCost ?? 0), 0);
  const openOrders = orders.filter((order) => !["RECEIVED", "CANCELLED"].includes(order.status)).length;

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function patchIngredient(item: Ingredient, patch: Record<string, unknown>) {
    setBusyId(item.id);
    try {
      const updated = await api.patch<Ingredient>(`/ingredients/${item.id}`, patch);
      setIngredients((current) => current.map((row) => (row.id === item.id ? updated : row)));
      succeed(`${updated.name} updated.`);
    } catch (error) {
      fail(errorMessage(error));
      // The row still shows the optimistic edit; refetch to restore truth.
      void refreshIngredients();
    } finally {
      setBusyId(null);
    }
  }

  async function archiveIngredient(item: Ingredient) {
    if (!window.confirm(`Archive "${item.name}"? It stays in history but leaves the active list.`)) return;
    try {
      await api.delete(`/ingredients/${item.id}`);
      setIngredients((current) => current.filter((row) => row.id !== item.id));
      succeed(`${item.name} archived.`);
    } catch (error) {
      fail(errorMessage(error));
    }
  }

  async function submit(action: () => Promise<string>) {
    setSaving(true);
    try {
      succeed(await action());
      setModal(null);
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function generateOrders() {
    if (!cycle) {
      fail("No cycle is available to generate purchase orders from.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.post<GenerationResult>("/purchase-orders/generate", {
        cycleId: cycle.id,
        weekNumber: week,
      });
      setGeneration(result);
      setOrders(result.orders);
      succeed(
        `Week ${week}: ${result.orders.length} vendor order(s).` +
          (result.unsourced.length ? ` ${result.unsourced.length} item(s) have no vendor.` : ""),
      );
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function transitionOrder(order: PurchaseOrder, status: string) {
    try {
      const updated = await api.patch<PurchaseOrder>(`/purchase-orders/${order.id}`, { status });
      setOrders((current) => current.map((row) => (row.id === order.id ? updated : row)));
      succeed(`${order.vendor.name} order marked ${status.toLowerCase().replace("_", " ")}.`);
    } catch (error) {
      fail(errorMessage(error));
    }
  }

  return (
    <main className="inventory-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">
            Inventory &amp; Procurement · Main Kitchen{cycle ? ` · ${cycle.name}` : ""}
          </div>
          <h1>Kitchen Operations</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setModal({ kind: "vendor" })}>+ Vendor</button>
          <button className="btn btn-ghost" onClick={() => setModal({ kind: "ingredient" })}>+ Item</button>
          <a className="btn btn-ghost" href="/api/v1/inventory/export.csv">↓ CSV</a>
          <button className="btn btn-copper" onClick={() => setTab("outreach")}>📤 Vendor Outreach</button>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Total Items" value={String(ingredients.length)} sub="on the master list" />
        <Kpi label="Out of Stock" value={String(ingredients.filter((i) => i.parStatus === "out-of-stock").length)} sub="nothing on hand" tone="warn" />
        <Kpi label="Below Par" value={String(belowPar.length)} sub="reorder now" tone={belowPar.length ? "warn" : ""} />
        <Kpi label="Open Orders" value={String(openOrders)} sub={`week ${week}`} />
        <Kpi label="Projected Spend" value={inr(projectedSpend)} sub="to return to par" />
      </div>

      <div className="inventory-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      {tab === "items" && (
        <IngredientTable
          ingredients={filtered}
          filters={filters}
          busyId={busyId}
          onFilterChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          onPatch={patchIngredient}
          onReceive={(ingredient) => setModal({ kind: "movement", ingredient })}
          onArchive={archiveIngredient}
          onAdd={() => setModal({ kind: "ingredient" })}
        />
      )}

      {tab === "par" && (
        <ParLevelsPanel
          ingredients={ingredients}
          onPatch={patchIngredient}
          onReceive={(ingredient) => setModal({ kind: "movement", ingredient })}
        />
      )}

      {tab === "vessels" && (
        <VesselsPanel
          kits={kits}
          consumables={ingredients.filter((item) => item.category === "vessel")}
          onAdd={() => setModal({ kind: "vessel" })}
          onUpdate={async (kit, patch) => {
            try {
              const updated = await api.patch<VesselKit>(`/vessel-kits/${kit.id}`, patch);
              setKits((current) => current.map((row) => (row.id === kit.id ? updated : row)));
              succeed(`${kit.subscriberName}'s kit updated.`);
            } catch (error) {
              fail(errorMessage(error));
            }
          }}
        />
      )}

      {tab === "vendors" && (
        <VendorsPanel
          vendors={vendors}
          onAdd={() => setModal({ kind: "vendor" })}
          onEdit={(vendor) => setModal({ kind: "vendor", vendor })}
        />
      )}

      {tab === "outreach" && (
        <OutreachPanel
          orders={orders}
          week={week}
          weekCount={cycle?.weekCount ?? 4}
          generation={generation}
          busy={saving}
          onWeekChange={(next) => { setWeek(next); setGeneration(null); }}
          onGenerate={() => void generateOrders()}
          onTransition={(order, status) => void transitionOrder(order, status)}
          onReceive={(order) => setModal({ kind: "receive", order })}
          onError={fail}
        />
      )}

      {tab === "cost" && <CostPanel summary={cost} onRefresh={() => void loadCost()} />}

      {modal?.kind === "ingredient" && (
        <IngredientModal
          vendors={vendors}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(values) =>
            void submit(async () => {
              const created = await api.post<Ingredient>("/ingredients", values);
              setIngredients((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
              return `${created.name} added to the ingredient list.`;
            })
          }
        />
      )}

      {modal?.kind === "vendor" && (
        <VendorModal
          vendor={modal.vendor}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(values) =>
            void submit(async () => {
              const existing = modal.vendor;
              const saved = existing
                ? await api.patch<Vendor>(`/vendors/${existing.id}`, values)
                : await api.post<Vendor>("/vendors", values);
              setVendors((current) =>
                existing
                  ? current.map((row) => (row.id === existing.id ? saved : row))
                  : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)),
              );
              return `${saved.name} saved.`;
            })
          }
        />
      )}

      {modal?.kind === "vessel" && (
        <VesselModal
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(values) =>
            void submit(async () => {
              const kit = await api.post<VesselKit>("/vessel-kits", values);
              setKits((current) => [...current, kit]);
              return `Vessel kit registered for ${kit.subscriberName}.`;
            })
          }
        />
      )}

      {modal?.kind === "movement" && (
        <MovementModal
          ingredient={modal.ingredient}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(values) =>
            void submit(async () => {
              await api.post("/inventory/movements", values);
              await refreshIngredients();
              return `Stock movement recorded for ${modal.ingredient.name}.`;
            })
          }
        />
      )}

      {modal?.kind === "receive" && (
        <ReceiveOrderModal
          order={modal.order}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(values) =>
            void submit(async () => {
              const result = await api.post<{ order: PurchaseOrder; fullyReceived: boolean; movements: unknown[] }>(
                `/purchase-orders/${modal.order.id}/receive`,
                values,
              );
              setOrders((current) => current.map((row) => (row.id === modal.order.id ? result.order : row)));
              await refreshIngredients();
              return `${result.movements.length} stock movement(s) recorded. Order is ${result.order.status
                .toLowerCase()
                .replace("_", " ")}.`;
            })
          }
        />
      )}
    </main>
  );
}
