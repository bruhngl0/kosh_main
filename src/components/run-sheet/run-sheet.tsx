"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import type { RunSheetView } from "@/modules/runsheet";
import { TASK_OWNERS, type PhaseId, type TaskOwner, type VesselState } from "@/shared/schemas/run-sheet";

const MEAL_NAMES: Record<string, string> = { BF: "Breakfast", SN: "Snack", LU: "Lunch", DI: "Dinner" };

/** Click order for a vessel chip; the last step wraps back to "not dispatched". */
const VESSEL_NEXT: Record<string, VesselState | null> = { none: "out", out: "collected", collected: "missing", missing: null };
const VESSEL_LABEL: Record<string, string> = { none: "—", out: "Out", collected: "Collected", missing: "Missing" };

const shiftDate = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const g = (value: number | null, unit = "g") => (value === null ? "—" : `${value.toLocaleString("en-IN")}${unit}`);

export function RunSheet({ initialSheet, today }: { initialSheet: RunSheetView; today: string }) {
  const router = useRouter();
  const [sheet, setSheet] = useState(initialSheet);
  const [collapsed, setCollapsed] = useState<Set<PhaseId>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState<string | null>(null);
  const [showAllStock, setShowAllStock] = useState(false);
  const { feedback, succeed, fail, clear } = useFeedback();
  const ticket = useRef(0);
  const { date } = sheet;
  const base = `/run-sheets/${date}`;

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const next = await api.get<RunSheetView>(`/run-sheets/${date}`);
      if (mine === ticket.current) setSheet(next);
    } catch (error) {
      fail(errorMessage(error));
    }
  }, [date, fail]);

  /** Runs a write, then re-reads the sheet so every derived number stays honest. */
  async function act(key: string, write: () => Promise<unknown>, message?: string) {
    setBusy(key);
    try {
      await write();
      await reload();
      if (message) succeed(message);
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const go = (next: string) => router.push(`/run-sheet?date=${next}`);

  async function saveBrief(field: "chefName" | "dispatchWindow" | "specialNotes" | "notes", value: string) {
    const current = sheet.brief[field] ?? "";
    if (value.trim() === current) return;
    await act(`brief-${field}`, () => api.patch(base, { [field]: value }), field === "notes" ? "Notes saved." : undefined);
  }

  /** BR-31 — take the day's unrecorded meals off stock. A shortfall offers an explicit override. */
  async function recordProduction(allowNegative = false) {
    if (!cycle) return;
    if (allowNegative && !window.confirm("Stock will go below zero for the short ingredients. The override is recorded on each movement. Continue?")) return;
    setBusy("production");
    setShortfall(null);
    try {
      const result = await api.post<{ meals: string[]; consumed: unknown[]; exceptions: unknown[] }>(
        `/cycles/${cycle.id}/days/${cycle.dayNumber}/consume`,
        { allowNegative },
      );
      await reload();
      succeed(
        `${result.meals.map((m) => MEAL_NAMES[m]).join(", ")} taken off stock: ${result.consumed.length} ingredient(s).` +
          (result.exceptions.length ? ` ${result.exceptions.length} could not be converted — check them in Inventory.` : ""),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") setShortfall(error.message);
      else fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function toggleTask(key: string, done: boolean) {
    // Optimistic: the tick shows immediately; the reload corrects it if the write fails.
    setSheet((s) => ({
      ...s,
      phases: s.phases.map((phase) => ({
        ...phase,
        tasks: phase.tasks.map((task) => (task.key === key ? { ...task, done } : task)),
      })),
      progress: { ...s.progress, done: s.progress.done + (done ? 1 : -1) },
    }));
    void act(key, async () => {
      const result = await api.put<{ sanitised?: number }>(`${base}/checks`, { taskKey: key, done });
      if (result.sanitised) succeed(`${result.sanitised} vessel kit(s) marked sanitised today.`);
    });
  }

  function cycleVessel(subscriberId: string, current: VesselState | null) {
    const status = VESSEL_NEXT[current ?? "none"];
    setSheet((s) => ({ ...s, vessels: s.vessels.map((v) => (v.id === subscriberId ? { ...v, vessel: status } : v)) }));
    void act(`vessel-${subscriberId}`, () => api.put(`${base}/vessels/${subscriberId}`, { status }));
  }

  function togglePrep(id: string, done: boolean) {
    void act(`prep-${id}`, () => api.patch(`/prep-tasks/${id}`, { status: done ? "DONE" : "OPEN" }));
  }

  const { cycle, brief, roster, macros, progress } = sheet;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const vesselCounts = sheet.vessels.reduce(
    (counts, v) => ({ ...counts, [v.vessel ?? "none"]: (counts[v.vessel ?? "none"] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const servingsDrift = roster.plannedServings !== null && roster.plannedServings !== roster.count;
  const prepOpen = sheet.prep.filter((task) => task.status === "OPEN").length;
  const { stock } = sheet;
  const shortLines = stock?.lines.filter((line) => line.shortBy > 0) ?? [];
  const stockLines = showAllStock ? (stock?.lines ?? []) : shortLines;
  const withoutKit = sheet.vessels.filter((v) => !v.kit).length;
  const stillMissing = sheet.vessels.filter((v) => v.missingSince).length;

  return (
    <main className="run-sheet-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Run Sheet · Kōsh Private Kitchen · Sadashivanagar</div>
          <h1>
            {sheet.weekday}
            {date === today && <span className="rs-today">Today</span>}
          </h1>
        </div>
        <div className="header-actions rs-nav">
          <button className="btn btn-ghost" onClick={() => go(shiftDate(date, -1))} aria-label="Previous day">
            ‹
          </button>
          <input
            className="add-field"
            type="date"
            aria-label="Production date"
            value={date}
            onChange={(event) => event.target.value && go(event.target.value)}
          />
          <button className="btn btn-ghost" onClick={() => go(shiftDate(date, 1))} aria-label="Next day">
            ›
          </button>
          {date !== today && (
            <button className="btn btn-ghost" onClick={() => go(today)}>
              Today
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => window.print()}>
            Print
          </button>
          <button
            className="btn btn-copper"
            disabled={busy === "all" || progress.done === progress.total}
            onClick={() => void act("all", () => api.put(`${base}/checks`, { all: true }), "Every task ticked.")}
          >
            ✓ Mark all done
          </button>
        </div>
      </div>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      {!cycle && (
        <div className="rs-banner">
          <b>No cycle covers {shortDate(date)}.</b> The checklist, roster and vessels still work; the menu, macros and
          allergen check need a cycle with a start date.
          {sheet.cycleRanges.length > 0 && (
            <span className="rs-ranges">
              {sheet.cycleRanges.map((range) => (
                <button key={range.name} className="subscribers-link" onClick={() => go(range.from)}>
                  {range.name} ({range.status.toLowerCase()}): {shortDate(range.from)} – {shortDate(range.to)} →
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      {/* ── Brief ───────────────────────────────────────────────────────── */}
      <div className="rs-brief">
        <div className="rs-card rs-card-copper">
          <small>Today&apos;s chef</small>
          <input
            className="rs-input"
            defaultValue={brief.chefName ?? ""}
            placeholder={brief.defaultChef ?? "Chef name"}
            aria-label="Today's chef"
            onBlur={(event) => void saveBrief("chefName", event.target.value)}
          />
          <span>{cycle ? `${cycle.name} · Day ${cycle.dayNumber} of ${cycle.durationDays}` : "No cycle"}</span>
        </div>
        <div className="rs-card">
          <small>Delivering</small>
          <strong>
            {roster.count} <em>/ {roster.capacity}</em>
          </strong>
          <span>
            {roster.planSplit.map((p) => `${p.count} ${p.plan}`).join(" · ") || "Nobody active"}
            {roster.startingSoon > 0 && ` · ${roster.startingSoon} starting this week`}
          </span>
        </div>
        <div className={`rs-card ${servingsDrift ? "rs-card-warn" : ""}`}>
          <small>Cycle day</small>
          <strong>{cycle ? `Week ${cycle.weekNumber}` : "—"}</strong>
          <span>
            {cycle ? `${cycle.phaseLabel ?? ""} · ${cycle.status.toLowerCase()}` : "—"}
            {servingsDrift && ` · planned for ${roster.plannedServings}, delivering ${roster.count}`}
          </span>
        </div>
        <div className="rs-card">
          <small>Dispatch window</small>
          <input
            className="rs-input"
            defaultValue={brief.dispatchWindow ?? ""}
            placeholder="7:30 AM"
            aria-label="Dispatch window"
            onBlur={(event) => void saveBrief("dispatchWindow", event.target.value)}
          />
          <span>Collection 7–9 PM tonight</span>
        </div>
        <div className={`rs-card ${sheet.allergyAlerts.length ? "rs-card-alert" : ""}`}>
          <small>Special notes</small>
          <input
            className="rs-input rs-input-sm"
            defaultValue={brief.specialNotes ?? ""}
            placeholder="None"
            aria-label="Special notes"
            onBlur={(event) => void saveBrief("specialNotes", event.target.value)}
          />
          <span>
            {sheet.allergyAlerts.length
              ? `${sheet.allergyAlerts.length} allergy alert${sheet.allergyAlerts.length === 1 ? "" : "s"} below`
              : "No allergy alerts"}
          </span>
        </div>
      </div>

      <div className="rs-macros">
        {(
          [
            ["Kcal per person", macros.kcal === null ? "—" : macros.kcal.toLocaleString("en-IN")],
            ["Protein", g(macros.protein)],
            ["Carbs", g(macros.carbs)],
            ["Fat", g(macros.fat)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rs-macro">
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <div className="rs-columns">
        {/* ── Menu ─────────────────────────────────────────────────────── */}
        <section className="inventory-card">
          <div className="card-toolbar">
            <h2>Today&apos;s menu</h2>
            {cycle && <Link href={`/cycles?cycle=${cycle.id}`}>Open in planner →</Link>}
          </div>
          {sheet.meals.length === 0 ? (
            <p className="rs-empty">{cycle ? "Nothing is assigned to this day yet." : "No menu without a cycle."}</p>
          ) : (
            <ul className="rs-menu">
              {sheet.meals.map((meal) => (
                <li key={meal.mealType}>
                  <span className="rs-meal">{MEAL_NAMES[meal.mealType]}</span>
                  <div>
                    <b>{meal.title}</b>
                    {meal.subtitle && <small>{meal.subtitle}</small>}
                    <div className="rs-meal-meta">
                      {meal.kcal !== null && <span>{meal.kcal} kcal</span>}
                      {meal.proteinGrams !== null && <span>P {meal.proteinGrams}g</span>}
                      {meal.carbsGrams !== null && <span>C {meal.carbsGrams}g</span>}
                      {meal.fatGrams !== null && <span>F {meal.fatGrams}g</span>}
                      {meal.protein && <span>· {meal.protein}</span>}
                    </div>
                    {meal.allergens.length > 0 && (
                      <div className="subscribers-allergies">
                        {meal.allergens.map((a) => (
                          <span key={a} className="allergen">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="rs-stack">
          {/* ── Allergy alerts ────────────────────────────────────────── */}
          <section className={`inventory-card ${sheet.allergyAlerts.length ? "rs-alerts" : ""}`}>
            <div className="card-toolbar">
              <h2>Allergy alerts</h2>
              <span>{sheet.allergyAlerts.length || "none"}</span>
            </div>
            {sheet.allergyAlerts.length === 0 ? (
              <p className="rs-empty">
                {sheet.meals.length
                  ? "No delivered subscriber's allergies touch today's dishes."
                  : "Checked once the day has a menu."}
              </p>
            ) : (
              <ul className="rs-alert-list">
                {sheet.allergyAlerts.map((alert) => (
                  <li key={alert.subscriberId}>
                    <b>{alert.name}</b>
                    {alert.clashes.map((clash) => (
                      <span key={`${clash.mealType}-${clash.allergen}-${clash.allergy}`} className="rs-clash">
                        {clash.meal}: {clash.dish} contains <em>{clash.allergen}</em> · on file: “{clash.allergy}”
                      </span>
                    ))}
                    {alert.unrecognised.length > 0 && (
                      <span className="rs-unknown">
                        Check by hand: “{alert.unrecognised.join("”, “")}” is not an allergen the system recognises
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Advance prep due ──────────────────────────────────────── */}
          <section className="inventory-card">
            <div className="card-toolbar">
              <h2>Advance prep due today</h2>
              <span>
                {sheet.prep.length ? `${sheet.prep.length - prepOpen}/${sheet.prep.length}` : "none"}
              </span>
            </div>
            {sheet.prep.length === 0 ? (
              <p className="rs-empty">Nothing due. Prep is generated from the cycle planner.</p>
            ) : (
              <ul className="rs-prep">
                {sheet.prep.map((task) => (
                  <li key={task.id} className={task.status === "DONE" ? "done" : task.status === "SKIPPED" ? "skipped" : ""}>
                    <input
                      type="checkbox"
                      checked={task.status === "DONE"}
                      disabled={busy === `prep-${task.id}` || task.status === "SKIPPED"}
                      aria-label={task.text}
                      onChange={(event) => togglePrep(task.id, event.target.checked)}
                    />
                    <div>
                      <span>{task.text}</span>
                      <small>
                        {task.dishTitle ?? "—"}
                        {task.mealType && ` · ${MEAL_NAMES[task.mealType]}`}
                        {task.serviceDate && ` · served ${shortDate(task.serviceDate)}`}
                        {task.completedBy && ` · done by ${task.completedBy}`}
                      </small>
                    </div>
                    <span className={`rs-lead ${task.urgent ? "urgent" : ""}`}>{task.leadLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ── Stock (BR-31) ─────────────────────────────────────────────── */}
      {stock && (
        <section className={`inventory-card rs-stock ${shortLines.length && stock.pendingMeals.length ? "rs-stock-short" : ""}`}>
          <div className="card-toolbar">
            <h2>Stock for today&apos;s menu</h2>
            <span>
              {stock.pendingMeals.length === 0 && stock.assignedMeals.length
                ? "recorded"
                : `${stock.lines.length} ingredients · ${shortLines.length} short`}
            </span>
          </div>
          {stock.runs.length > 0 && (
            <p className="rs-stock-runs">
              {stock.runs.map((run) => (
                <span key={run.mealType}>
                  ✓ {MEAL_NAMES[run.mealType]} taken off stock{" "}
                  {new Date(run.recordedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {run.recordedBy && ` by ${run.recordedBy}`}
                  {run.negativeOverride && " (override)"}
                </span>
              ))}
            </p>
          )}
          {stock.pendingMeals.length > 0 && (
            <>
              {stockLines.length > 0 ? (
                <table className="rs-stock-table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Needed</th>
                      <th>On hand</th>
                      <th>Short by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockLines.map((line) => (
                      <tr key={line.ingredientId} className={line.shortBy > 0 ? "short" : ""}>
                        <td>{line.ingredientName}</td>
                        <td>
                          {line.needed.toLocaleString("en-IN")} {line.unit}
                        </td>
                        <td>
                          {line.onHand.toLocaleString("en-IN")} {line.unit}
                        </td>
                        <td>{line.shortBy > 0 ? `${line.shortBy.toLocaleString("en-IN")} ${line.unit}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="rs-empty">Everything the menu needs is in stock.</p>
              )}
              <div className="rs-stock-actions">
                {stock.lines.length > shortLines.length && (
                  <button className="subscribers-link" onClick={() => setShowAllStock((v) => !v)}>
                    {showAllStock ? "Show shortages only" : `Show all ${stock.lines.length} ingredients`}
                  </button>
                )}
                {stock.exceptions.length > 0 && (
                  <span className="rs-unknown">{stock.exceptions.length} ingredient(s) have units that cannot be converted and will be skipped.</span>
                )}
                <span className="rs-spacer" />
                {stock.cycleStatus === "DRAFT" ? (
                  <span className="rs-hint-inline">Publish the cycle to record production.</span>
                ) : (
                  <button className="btn btn-copper" disabled={busy === "production"} onClick={() => void recordProduction()}>
                    {busy === "production"
                      ? "Recording…"
                      : `Record production — take ${stock.pendingMeals.map((m) => MEAL_NAMES[m]).join(", ")} off stock`}
                  </button>
                )}
              </div>
              {shortfall && (
                <div className="rs-shortfall" role="alert">
                  <span>{shortfall} Receive stock in Inventory first, or record anyway.</span>
                  <button className="btn btn-ghost" disabled={busy === "production"} onClick={() => void recordProduction(true)}>
                    Record anyway (override)
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Checklist ──────────────────────────────────────────────────── */}
      <div className="rs-progress">
        <div>
          <small>Daily checklist</small>
          <span>
            <b>{progress.done}</b> of <b>{progress.total}</b> tasks complete
          </span>
        </div>
        <div className="rs-track">
          <div className={`rs-fill ${pct === 100 ? "done" : ""}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {sheet.phases.map((phase) => {
        const done = phase.tasks.filter((task) => task.done).length;
        const isCollapsed = collapsed.has(phase.id);
        return (
          <section key={phase.id} className={`rs-phase rs-phase-${phase.id}`}>
            <button
              className="rs-phase-head"
              aria-expanded={!isCollapsed}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(phase.id)) next.delete(phase.id);
                  else next.add(phase.id);
                  return next;
                })
              }
            >
              <span className={`rs-dot ${done === phase.tasks.length ? "full" : ""}`} />
              <h2>{phase.name}</h2>
              <span className="rs-count">
                {done}/{phase.tasks.length}
              </span>
              <span className="rs-window">{phase.window}</span>
              <span className="rs-caret">{isCollapsed ? "▸" : "▾"}</span>
            </button>
            {!isCollapsed && (
              <div className="rs-tasks">
                {phase.tasks.map((task) => (
                  <label
                    key={task.key}
                    className={`rs-task ${task.done ? "done" : ""} ${task.critical ? "critical" : ""} ${task.vessel ? "vessel" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      disabled={task.derived}
                      title={task.derived ? "Ticks itself when production is recorded" : undefined}
                      onChange={(event) => toggleTask(task.key, event.target.checked)}
                    />
                    <div className="rs-task-body">
                      <span>{task.title}</span>
                      {task.sub && <small>{task.sub}</small>}
                      {task.done && task.doneBy && <small className="rs-by">✓ {task.doneBy}</small>}
                      {task.derived && !task.done && <small className="rs-auto">Automatic — record production in the Stock card</small>}
                    </div>
                    <span className={`rs-owner owner-${task.owner.toLowerCase()}`}>{task.owner}</span>
                    <span className="rs-time">
                      {task.time}
                      {task.critical && " ⚠"}
                      {task.custom && (
                        <button
                          type="button"
                          className="rs-remove"
                          aria-label={`Remove ${task.title}`}
                          onClick={(event) => {
                            event.preventDefault();
                            void act(`rm-${task.key}`, () => api.delete(`${base}/tasks/${task.key}`), "Task removed.");
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </label>
                ))}
                <AddTask phase={phase.id} onAdd={(title, owner) => act(`add-${phase.id}`, () => api.post(`${base}/tasks`, { phase: phase.id, title, owner }))} />
              </div>
            )}
          </section>
        );
      })}

      {/* ── Vessels / delivery list ───────────────────────────────────── */}
      <section className="inventory-card rs-vessels">
        <div className="card-toolbar">
          <h2>Vessels &amp; delivery list</h2>
          <span>
            {vesselCounts.out ?? 0} out · {vesselCounts.collected ?? 0} collected · {vesselCounts.missing ?? 0} missing ·{" "}
            {vesselCounts.none ?? 0} not dispatched
            {withoutKit > 0 && ` · ${withoutKit} without a kit`}
            {stillMissing > 0 && ` · ${stillMissing} missing from earlier days`}
          </span>
        </div>
        <p className="rs-hint">Click a vessel to move it on: dispatched → collected → missing → reset.</p>
        {sheet.vessels.length === 0 ? (
          <p className="rs-empty">Nobody is due a delivery on this date.</p>
        ) : (
          <div className="rs-vessel-grid">
            {sheet.vessels.map((v) => (
              <button
                key={v.id}
                className={`rs-vessel ${v.vessel ?? "none"} ${v.flagged ? "flagged" : ""}`}
                onClick={() => cycleVessel(v.id, v.vessel)}
                title={[v.address, v.deliveryNote].filter(Boolean).join(" — ")}
              >
                <b>{v.name}</b>
                <small>
                  {[v.deliverySlot, v.landmark].filter(Boolean).join(" · ") || v.plan || "—"}
                </small>
                {v.allergies.length > 0 && <small className="rs-vessel-allergy">⚠ {v.allergies.join(", ")}</small>}
                {v.missingSince && <small className="rs-vessel-warn">Missing since {shortDate(v.missingSince)}</small>}
                {!v.kit ? (
                  <small className="rs-vessel-warn">No kit registered</small>
                ) : v.kit.status === "needs-replace" ? (
                  <small className="rs-vessel-warn">Kit needs replacing</small>
                ) : v.kit.sanitisationOverdue ? (
                  <small className="rs-vessel-amber">Clean overdue{v.kit.sanitisedAt ? ` · last ${shortDate(v.kit.sanitisedAt)}` : ""}</small>
                ) : (
                  <small>
                    {v.kit.type === "copper" ? "Copper" : "Steel"} · {v.kit.sets} set{v.kit.sets === 1 ? "" : "s"}
                  </small>
                )}
                <span className="rs-vessel-state">{VESSEL_LABEL[v.vessel ?? "none"]}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="inventory-card rs-notes">
        <div className="card-toolbar">
          <h2>Kitchen &amp; delivery notes</h2>
        </div>
        <textarea
          defaultValue={brief.notes ?? ""}
          rows={4}
          aria-label="Kitchen and delivery notes"
          placeholder="Quality issues, subscriber feedback, substitutions, delivery problems, prep notes for tomorrow…"
          onBlur={(event) => void saveBrief("notes", event.target.value)}
        />
      </section>
    </main>
  );
}

function AddTask({ phase, onAdd }: { phase: PhaseId; onAdd: (title: string, owner: TaskOwner) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<TaskOwner>("Chef");

  async function submit() {
    if (title.trim().length < 2) return;
    await onAdd(title.trim(), owner);
    setTitle("");
  }

  return (
    <div className="rs-add">
      <input
        className="add-field"
        value={title}
        placeholder="+ Add a task for today…"
        aria-label={`Add a task to ${phase}`}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void submit()}
      />
      <select className="add-field" value={owner} aria-label="Owner" onChange={(event) => setOwner(event.target.value as TaskOwner)}>
        {TASK_OWNERS.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <button className="btn btn-ghost" type="button" onClick={() => void submit()}>
        Add
      </button>
    </div>
  );
}
