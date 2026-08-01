"use client";

import { useMemo, useState } from "react";
import { MEAL_NAMES, type MealType, type PrepTask } from "./types";

/**
 * Advance-prep worklist.
 *
 * Restores the prototype's grouping by week and day plus the lead-time badge
 * (Kosh_Cycle_Planner.html:543). The React rewrite had rendered a flat list
 * with the task text duplicated into both the title and the subtitle, and no
 * lead time at all — every task looked equally urgent.
 */

const LEAD_CLASS: Record<string, string> = {
  D3: "lead-urgent",
  H24: "lead-today",
  DAY_BEFORE: "lead-tomorrow",
  SAME_DAY: "lead-same",
};

export function PrepPanel({
  tasks,
  onToggle,
  onGenerate,
  generating,
}: {
  tasks: PrepTask[];
  onToggle: (task: PrepTask) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const [showDone, setShowDone] = useState(false);

  const visible = useMemo(
    () => (showDone ? tasks : tasks.filter((task) => task.status !== "DONE")),
    [tasks, showDone],
  );

  const byWeek = useMemo(() => {
    const groups = new Map<number, Map<number, PrepTask[]>>();
    for (const task of visible) {
      const week = groups.get(task.weekNumber) ?? new Map<number, PrepTask[]>();
      const day = week.get(task.dayNumber) ?? [];
      day.push(task);
      week.set(task.dayNumber, day);
      groups.set(task.weekNumber, week);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [visible]);

  const criticalCount = tasks.filter((task) => task.urgent && task.status === "OPEN").length;

  if (!tasks.length) {
    return (
      <div className="panel-stack">
        <div className="empty">
          <p>No advance-prep tasks yet.</p>
          <button className="btn btn-copper btn-small" onClick={onGenerate} disabled={generating}>
            {generating ? "Generating…" : "Generate from the menu"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-stack">
      <div className="card-toolbar">
        <h2>
          {visible.length} task{visible.length === 1 ? "" : "s"}
          {criticalCount > 0 && <span className="stock-low"> · {criticalCount} critical</span>}
        </h2>
        <div className="inventory-filters">
          <label className="toggle-label">
            <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
            Show completed
          </label>
          <button className="btn btn-ghost btn-small" onClick={onGenerate} disabled={generating}>
            {generating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>

      {byWeek.map(([weekNumber, days]) => (
        <div className="advance-week" key={weekNumber}>
          <div className="week-header">
            <span className="week-number">Week {weekNumber}</span>
            <span className={`wh-badge wb${Math.min(weekNumber, 4)}`}>
              {[...days.values()].flat().filter((task) => task.urgent).length} critical
            </span>
          </div>

          {[...days.entries()]
            .sort(([a], [b]) => a - b)
            .map(([dayNumber, dayTasks]) => (
              <div className="advance-day-group" key={dayNumber}>
                <div className="adg-header">
                  <span className="adg-daynum">Day {String(dayNumber).padStart(2, "0")}</span>
                  <span className="cell-muted">
                    {dayTasks.length} prep item{dayTasks.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="adg-items">
                  {dayTasks.map((task) => (
                    <div className={`adg-item ${task.status === "DONE" ? "done" : ""}`} key={task.id}>
                      <span className={`adg-lead ${LEAD_CLASS[task.taskType] ?? "lead-same"}`}>{task.leadLabel}</span>
                      <div>
                        <div className="adg-name">{task.text}</div>
                        <div className="adg-dish">
                          {task.mealType ? `${MEAL_NAMES[task.mealType as MealType]} — ` : ""}
                          {task.dishTitle ?? "Unlinked"}
                          {task.dueDate && <em> · start by {task.dueDate}</em>}
                          {task.completedBy && <em> · done by {task.completedBy}</em>}
                        </div>
                      </div>
                      <button
                        className={`adg-check ${task.status === "DONE" ? "checked" : ""}`}
                        onClick={() => onToggle(task)}
                        aria-label={task.status === "DONE" ? "Reopen task" : "Mark done"}
                      >
                        {task.status === "DONE" ? "✓" : ""}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
