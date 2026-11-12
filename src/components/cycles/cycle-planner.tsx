"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import { Field, Modal } from "@/components/ui/modal";
import { RecipeSelect } from "@/components/recipe-select";
import { Calendar, ConflictsPanel } from "./calendar";
import { PrepPanel } from "./prep-panel";
import { ProductionPanel } from "./production-panel";
import {
  MEAL_NAMES,
  MEAL_ORDER,
  type Conflict,
  type CycleDay,
  type CycleStats,
  type CycleSummary,
  type MealType,
  type PrepTask,
  type ProductionPlan,
  type RecipeOption,
} from "./types";

type Tab = "calendar" | "conflicts" | "advance" | "production";

export function CyclePlanner({
  cycle,
  cycles,
  days: initialDays,
  conflicts: initialConflicts,
  stats: initialStats,
  prepTasks: initialPrepTasks,
  recipeOptions,
}: {
  cycle: CycleSummary;
  cycles: { id: string; name: string; cycleNumber: number; status: string }[];
  days: CycleDay[];
  conflicts: Conflict[];
  stats: CycleStats;
  prepTasks: PrepTask[];
  recipeOptions: RecipeOption[];
}) {
  const router = useRouter();
  const { feedback, succeed, fail, clear } = useFeedback();

  const [tab, setTab] = useState<Tab>("calendar");
  const [days, setDays] = useState(initialDays);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [stats, setStats] = useState(initialStats);
  const [prepTasks, setPrepTasks] = useState(initialPrepTasks);
  const [selectedDay, setSelectedDay] = useState<CycleDay | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [productionWeek, setProductionWeek] = useState(1);
  const [production, setProduction] = useState<ProductionPlan | null>(null);
  const [loadingProduction, setLoadingProduction] = useState(false);
  const [busy, setBusy] = useState<null | "publish" | "prep" | "create" | "headcount">(null);
  const [headcount, setHeadcount] = useState({ count: cycle.subscriberCount, syncedAt: cycle.headcountSyncedAt });
  const followsRoster = cycle.status === "DRAFT" || cycle.status === "ACTIVE";

  const criticalPrep = prepTasks.filter((task) => task.urgent && task.status === "OPEN").length;

  const refreshCalendar = useCallback(async () => {
    const data = await api.get<{ cycle: CycleSummary; days: CycleDay[]; conflicts: Conflict[]; stats: CycleStats }>(
      `/cycles/${cycle.id}`,
    );
    setHeadcount({ count: data.cycle.subscriberCount, syncedAt: data.cycle.headcountSyncedAt });
    setDays(data.days);
    setConflicts(data.conflicts);
    setStats(data.stats);
  }, [cycle.id]);

  const loadProduction = useCallback(
    async (week: number) => {
      setLoadingProduction(true);
      try {
        setProduction(await api.get<ProductionPlan>(`/cycles/${cycle.id}/production?week=${week}`));
      } catch (error) {
        fail(errorMessage(error));
      } finally {
        setLoadingProduction(false);
      }
    },
    [cycle.id, fail],
  );

  useEffect(() => {
    if (tab === "production") void loadProduction(productionWeek);
  }, [tab, productionWeek, loadProduction]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** BR-30 — "Sync from roster": servings follow who is actually delivered to each day. */
  async function syncHeadcount() {
    setBusy("headcount");
    try {
      const result = await api.post<{ source: "roster" | "cycle"; headcount: number; changed: number }>(
        `/cycles/${cycle.id}/headcount`,
      );
      await refreshCalendar();
      succeed(
        result.source === "cycle"
          ? `No active subscribers on the roster yet, so the typed head-count of ${result.headcount} stands.`
          : result.changed
            ? `Head-count ${result.headcount}. Servings updated on ${result.changed} meal(s); hand-set servings and past days left alone.`
            : `Head-count ${result.headcount}. Servings already match the roster.`,
      );
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function assignRecipe(dayNumber: number, meal: MealType, recipeVersionId: string, servings?: number | null) {
    if (!recipeVersionId) return;
    try {
      await api.put(`/cycles/${cycle.id}/days/${dayNumber}/meals/${meal}`, {
        recipeVersionId,
        ...(servings !== undefined ? { servings } : {}),
      });
      await refreshCalendar();
      const updated = await api.get<{ days: CycleDay[] }>(`/cycles/${cycle.id}`);
      setSelectedDay(updated.days.find((day) => day.dayNumber === dayNumber) ?? null);
      succeed(`Day ${dayNumber} ${MEAL_NAMES[meal]} saved.`);
    } catch (error) {
      fail(errorMessage(error));
    }
  }

  async function clearSlot(dayNumber: number, meal: MealType) {
    try {
      await api.delete(`/cycles/${cycle.id}/days/${dayNumber}/meals/${meal}`);
      await refreshCalendar();
      const updated = await api.get<{ days: CycleDay[] }>(`/cycles/${cycle.id}`);
      setSelectedDay(updated.days.find((day) => day.dayNumber === dayNumber) ?? null);
      succeed(`Day ${dayNumber} ${MEAL_NAMES[meal]} cleared.`);
    } catch (error) {
      fail(errorMessage(error));
    }
  }

  async function generatePrep() {
    setBusy("prep");
    try {
      const result = await api.post<{ created: number; updated: number; removed: number; total: number }>(
        `/cycles/${cycle.id}/prep-tasks/generate`,
      );
      setPrepTasks(await api.get<PrepTask[]>(`/cycles/${cycle.id}/prep-tasks`));
      succeed(
        `${result.total} prep task(s): ${result.created} new, ${result.updated} refreshed` +
          (result.removed ? `, ${result.removed} no longer needed` : "") +
          ". Completed work was preserved.",
      );
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  /** BR-4 — a failed publish is a 422 listing the days that block it. */
  async function publish() {
    setBusy("publish");
    try {
      await api.post(`/cycles/${cycle.id}/publish`);
      succeed(`${cycle.name} is now active.`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNPROCESSABLE") {
        const problems = (error.details?.problems as { message: string }[] | undefined) ?? [];
        const days = (error.details?.incompleteDayNumbers as number[] | undefined) ?? [];
        fail(
          problems.length
            ? `${problems[0].message}${problems.length > 1 ? ` (+${problems.length - 1} more issue(s) across days ${days.join(", ")})` : ""}`
            : error.message,
        );
      } else {
        fail(errorMessage(error));
      }
    } finally {
      setBusy(null);
    }
  }

  async function togglePrep(task: PrepTask) {
    const next = task.status === "DONE" ? "OPEN" : "DONE";
    try {
      await api.patch(`/prep-tasks/${task.id}`, { status: next });
      setPrepTasks((current) =>
        current.map((item) => (item.id === task.id ? { ...item, status: next } : item)),
      );
    } catch (error) {
      fail(errorMessage(error));
    }
  }

  async function recordProduction(dayNumber: number) {
    if (!window.confirm(`Record production for day ${dayNumber}? This consumes ingredients from stock.`)) return;
    try {
      const result = await api.post<{ consumed: unknown[]; exceptions: unknown[] }>(
        `/cycles/${cycle.id}/days/${dayNumber}/consume`,
        {},
      );
      succeed(`Consumed ${result.consumed.length} ingredient(s) for day ${dayNumber}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
        fail(`${error.message} Receive stock first, or record an authorised override.`);
      } else {
        fail(errorMessage(error));
      }
    }
  }

  async function createCycle(form: HTMLFormElement) {
    const data = new FormData(form);
    const number = (key: string) => {
      const raw = data.get(key);
      return raw === null || raw === "" ? undefined : Number(raw);
    };

    setBusy("create");
    try {
      const created = await api.post<{ id: string }>("/cycles", {
        name: data.get("name"),
        cycleNumber: number("cycleNumber"),
        durationDays: number("durationDays"),
        weekStart: data.get("weekStart") || undefined,
        subscriberCount: number("subscriberCount"),
        foodCostTargetPercent: number("foodCostTargetPercent"),
        proteinWindowDays: number("proteinWindowDays"),
      });
      setShowCreate(false);
      router.push(`/cycles?cycle=${created.id}`);
      router.refresh();
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabs: [Tab, string][] = [
    ["calendar", `▦ ${cycle.durationDays}-Day Calendar`],
    ["conflicts", `⚠ Protein Conflicts${conflicts.length ? ` (${conflicts.length})` : ""}`],
    ["advance", `⏰ Advance Prep${criticalPrep ? ` (${criticalPrep})` : ""}`],
    ["production", "▤ Weekly Production"],
  ];

  return (
    <main className="planner-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">
            Cycle Planner · {cycle.durationDays} days · {stats.slotsTotal} slots
            {cycle.weekStart ? ` · starts ${cycle.weekStart}` : ""} · {cycle.status}
          </div>
          <h1>{cycle.name}</h1>
          <select
            className="cycle-selector"
            value={cycle.id}
            onChange={(event) => router.push(`/cycles?cycle=${event.target.value}`)}
          >
            {cycles.map((option) => (
              <option value={option.id} key={option.id}>
                Cycle {String(option.cycleNumber).padStart(2, "0")} · {option.name} · {option.status}
              </option>
            ))}
          </select>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setShowCreate(true)}>+ New Cycle</button>
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          {followsRoster && (
            <button className="btn btn-ghost" onClick={() => void syncHeadcount()} disabled={busy === "headcount"}>
              {busy === "headcount" ? "Syncing…" : "⇄ Sync from roster"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void generatePrep()} disabled={busy === "prep"}>
            {busy === "prep" ? "Generating…" : "Generate Prep"}
          </button>
          {cycle.status === "DRAFT" && (
            <button className="btn btn-copper" onClick={() => void publish()} disabled={busy === "publish"}>
              {busy === "publish" ? "Publishing…" : "Publish Cycle"}
            </button>
          )}
        </div>
      </div>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      <div className="status-bar">
        <Status n={String(stats.daysPlanned)} label="Days planned" sub="Full cycle" tone="ok" />
        <Status
          n={`${stats.slotsAssigned}/${stats.slotsTotal}`}
          label="Slots assigned"
          sub={stats.slotsMissing ? `${stats.slotsMissing} unassigned` : "Complete"}
          tone={stats.slotsMissing ? "warn" : "ok"}
        />
        <Status
          n={String(conflicts.length)}
          label="Protein conflicts"
          sub={conflicts.length ? "Review needed" : "All clear"}
          tone={conflicts.length ? "warn" : "ok"}
        />
        <Status
          n={String(criticalPrep)}
          label="Critical prep"
          sub="24hr+ lead required"
          tone={criticalPrep ? "warn" : "ok"}
        />
        <Status n={String(prepTasks.length)} label="Prep tasks" sub="Across the cycle" tone="ok" />
        <Status
          n={String(headcount.count)}
          label="Head-count"
          sub={
            !followsRoster
              ? "Cycle closed — fixed"
              : headcount.syncedAt
                ? `From roster · ${new Date(headcount.syncedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "Typed in — not synced yet"
          }
          tone={followsRoster && !headcount.syncedAt ? "warn" : "ok"}
        />
      </div>

      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "calendar" && (
        <Calendar days={days} weekCount={stats.weekCount} onSelect={setSelectedDay} />
      )}
      {tab === "conflicts" && (
        <ConflictsPanel conflicts={conflicts} windowDays={cycle.proteinWindowDays} />
      )}
      {tab === "advance" && (
        <PrepPanel
          tasks={prepTasks}
          onToggle={(task) => void togglePrep(task)}
          onGenerate={() => void generatePrep()}
          generating={busy === "prep"}
        />
      )}
      {tab === "production" && (
        <ProductionPanel
          plan={production}
          week={productionWeek}
          weekCount={stats.weekCount}
          loading={loadingProduction}
          onWeekChange={setProductionWeek}
          onConsume={(dayNumber) => void recordProduction(dayNumber)}
        />
      )}

      {selectedDay && (
        <DayModal
          day={selectedDay}
          recipeOptions={recipeOptions}
          conflicts={conflicts.filter((conflict) => conflict.dayNumber === selectedDay.dayNumber)}
          onClose={() => setSelectedDay(null)}
          onAssign={(meal, versionId, servings) => void assignRecipe(selectedDay.dayNumber, meal, versionId, servings)}
          onClear={(meal) => void clearSlot(selectedDay.dayNumber, meal)}
        />
      )}

      {showCreate && (
        <Modal
          title="New Cycle"
          subtitle="Creates an editable draft, then assign meals on the calendar."
          onClose={() => setShowCreate(false)}
          saving={busy === "create"}
          submitLabel="Create draft cycle"
          onSubmit={(form) => void createCycle(form)}
        >
          <div className="form-stack">
            <Field label="Cycle name *" name="name" required defaultValue={`Cycle ${String(cycle.cycleNumber + 1).padStart(2, "0")}`} />
            <Field label="Cycle number *" name="cycleNumber" type="number" min="1" required defaultValue={cycle.cycleNumber + 1} hint="Unique internal sequence number." />
            <Field label="Start date" name="weekStart" type="date" hint="Required for advance-prep due dates to be calculated." />
            <Field label="Duration in days *" name="durationDays" type="number" min="1" max="366" required defaultValue="28" />
            <Field label="Head-count *" name="subscriberCount" type="number" min="1" required defaultValue={cycle.subscriberCount} hint="Only used while the subscriber roster is empty; otherwise servings follow the roster day by day." />
            <Field label="Food-cost target (%)" name="foodCostTargetPercent" type="number" min="0" max="100" step="0.01" defaultValue="30" />
            <Field label="Protein repeat window (days)" name="proteinWindowDays" type="number" min="1" max="28" defaultValue="4" hint="No dinner protein may repeat inside this window." />
          </div>
        </Modal>
      )}
    </main>
  );
}

function Status({ n, label, sub, tone = "" }: { n: string; label: string; sub: string; tone?: string }) {
  return (
    <div className={`status-card ${tone}`}>
      <div className="status-number">{n}</div>
      <div className="status-label">{label}</div>
      <div className="status-sub">{sub}</div>
    </div>
  );
}

function DayModal({
  day,
  recipeOptions,
  conflicts,
  onClose,
  onAssign,
  onClear,
}: {
  day: CycleDay;
  recipeOptions: RecipeOption[];
  conflicts: Conflict[];
  onClose: () => void;
  onAssign: (meal: MealType, recipeVersionId: string, servings?: number | null) => void;
  onClear: (meal: MealType) => void;
}) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="day-modal">
        <div className="modal-head">
          <div>
            <h2>Day {String(day.dayNumber).padStart(2, "0")}</h2>
            <small>{day.date ?? "Date not set"} · Week {day.weekNumber} · {day.phaseLabel}</small>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {conflicts.map((conflict, index) => (
            <div className="mm-alert alert-conflict" key={index}>
              ⚠ {conflict.protein} repeats from Day {conflict.previousDayNumber} — try {conflict.suggestedSwap}
            </div>
          ))}

          {MEAL_ORDER.map((meal) => {
            const slot = day.meals[meal];
            const options = recipeOptions
              .filter((option) => option.mealType === meal)
              .map((option) => ({
                id: option.recipeVersionId,
                title: option.title,
                version: option.versionNumber,
              }));

            return (
              <div className="modal-meal" key={meal}>
                <div className="mm-header">
                  <span className={`meal-tag meal-${meal.toLowerCase()}`}>{MEAL_NAMES[meal]}</span>
                  <strong>{slot?.title ?? "Unassigned"}</strong>
                  {slot && (
                    <button className="icon-btn danger" title="Clear slot" onClick={() => onClear(meal)}>×</button>
                  )}
                </div>
                {slot?.subtitle && <div className="mm-sub">{slot.subtitle}</div>}
                <RecipeSelect
                  value={slot?.recipeVersionId ?? ""}
                  options={options}
                  onChange={(value) => onAssign(meal, value)}
                />
                {slot && (
                  <div className="mm-macros">
                    <div className="mm-macro"><div className="mm-macro-val">{slot.kcal ?? "—"}</div><div className="mm-macro-label">kcal</div></div>
                    <div className="mm-macro"><div className="mm-macro-val">{slot.proteinGrams ?? "—"}g</div><div className="mm-macro-label">protein</div></div>
                    <div className="mm-macro"><div className="mm-macro-val">{slot.protein}</div><div className="mm-macro-label">source</div></div>
                    <div className="mm-macro"><div className="mm-macro-val">×{slot.servings}</div><div className="mm-macro-label">{slot.servingsLocked ? "servings · fixed" : "servings · roster"}</div></div>
                  </div>
                )}
                {slot && (
                  <div className="mm-servings">
                    <label>
                      Fix servings
                      <input
                        key={`${slot.recipeVersionId}-${slot.servings}`}
                        className="add-field"
                        type="number"
                        min="1"
                        defaultValue={slot.servingsLocked ? slot.servings : ""}
                        placeholder={String(slot.servings)}
                        aria-label={`Fix servings for ${MEAL_NAMES[meal]}`}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (event.target.value && Number.isInteger(value) && value > 0 && value !== slot.servings) {
                            onAssign(meal, slot.recipeVersionId, value);
                          }
                        }}
                      />
                    </label>
                    {slot.servingsLocked && (
                      <button type="button" className="subscribers-link" onClick={() => onAssign(meal, slot.recipeVersionId, null)}>
                        ↺ Follow roster
                      </button>
                    )}
                  </div>
                )}
                {slot && slot.advanceCount > 0 && (
                  <div className="mm-alert alert-advance">⏰ {slot.advanceCount} advance-prep step(s)</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
