"use client";

import { MEAL_ORDER, type CycleDay, type Conflict } from "./types";

export function Calendar({
  days,
  weekCount,
  onSelect,
}: {
  days: CycleDay[];
  weekCount: number;
  onSelect: (day: CycleDay) => void;
}) {
  return (
    <div>
      <div className="legend">
        <span><i className="dot dot-green" />No issues</span>
        <span><i className="dot dot-red" />Protein repeat inside the window</span>
        <span><i className="dot dot-amber" />Advance prep required</span>
        <span className="legend-note">Click any day for meal detail</span>
      </div>

      {Array.from({ length: weekCount }, (_, index) => index + 1).map((week) => {
        const weekDays = days.filter((day) => day.weekNumber === week);
        if (!weekDays.length) return null;
        const phase = weekDays[0].phaseLabel;

        return (
          <section key={week}>
            <div className="week-header">
              <span className="week-number">Week {week}</span>
              <strong>Cycle phase: {phase}</strong>
              <span className={`phase phase-${Math.min(week, 4)}`}>{phase}</span>
            </div>
            <div className="day-grid">
              {weekDays.map((day) => {
                const assigned = MEAL_ORDER.filter((meal) => day.meals[meal]);
                const hasAdvance = assigned.some((meal) => (day.meals[meal]?.advanceCount ?? 0) > 0);
                const incomplete = assigned.length < MEAL_ORDER.length;

                return (
                  <button
                    className={`day-card ${day.hasConflict ? "has-conflict" : ""} ${incomplete ? "is-incomplete" : ""}`}
                    key={day.dayNumber}
                    onClick={() => onSelect(day)}
                  >
                    <div className="day-head">
                      <span>{String(day.dayNumber).padStart(2, "0")}</span>
                      <small>{day.date ? day.date.slice(5) : "—"}</small>
                      <i className={`dot ${day.hasConflict ? "dot-red" : hasAdvance ? "dot-amber" : "dot-green"}`} />
                    </div>
                    <div className="day-meals">
                      {MEAL_ORDER.map((meal) => {
                        const slot = day.meals[meal];
                        return slot ? (
                          <div className="day-meal" key={meal}>
                            <i className={`meal-dot meal-dot-${meal.toLowerCase()}`} />
                            <span>{slot.title}</span>
                            <small>{slot.protein}</small>
                          </div>
                        ) : (
                          <div className="day-meal day-meal-empty" key={meal}>
                            <i className="meal-dot" />
                            <span>— {meal} unassigned</span>
                          </div>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** BR-1/BR-2 — conflicts now carry the dish names and a suggested swap. */
export function ConflictsPanel({ conflicts, windowDays }: { conflicts: Conflict[]; windowDays: number }) {
  if (!conflicts.length) {
    return (
      <div className="panel-stack">
        <div className="success-box">
          ✓ No dinner protein repeats within {windowDays} days across this cycle.
        </div>
      </div>
    );
  }

  return (
    <div className="panel-stack">
      <div className="inventory-note">
        No dinner protein should repeat within {windowDays} days. Plant, dairy, and legume are exempt — they are
        staples, not features.
      </div>
      {conflicts.map((conflict, index) => (
        <div className="conflict-item" key={`${conflict.dayNumber}-${index}`}>
          <strong>Day {conflict.dayNumber}</strong>
          <span>
            <b>{conflict.protein}</b> repeats {conflict.gapDays} day{conflict.gapDays === 1 ? "" : "s"} after Day{" "}
            {conflict.previousDayNumber}
            {conflict.previousDishTitle ? ` (${conflict.previousDishTitle})` : ""}.
            {conflict.dishTitle ? ` Currently serving ${conflict.dishTitle}.` : ""}{" "}
            Consider swapping to <em>{conflict.suggestedSwap}</em>.
          </span>
        </div>
      ))}
    </div>
  );
}
