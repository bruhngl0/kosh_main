"use client";

import { MEAL_NAMES, type ProductionPlan } from "./types";

/**
 * Weekly production list — the sheet the kitchen prints.
 * Restores the prototype's summary strip and dinner protein rotation row
 * (Kosh_Cycle_Planner.html:599).
 */
export function ProductionPanel({
  plan,
  week,
  weekCount,
  loading,
  onWeekChange,
  onConsume,
}: {
  plan: ProductionPlan | null;
  week: number;
  weekCount: number;
  loading: boolean;
  onWeekChange: (week: number) => void;
  onConsume: (dayNumber: number) => void;
}) {
  return (
    <>
      <div className="week-select">
        {Array.from({ length: weekCount }, (_, index) => index + 1).map((item) => (
          <button key={item} className={week === item ? "selected" : ""} onClick={() => onWeekChange(item)}>
            Week {item}
          </button>
        ))}
        <button className="btn btn-ghost btn-small" onClick={() => window.print()}>🖨 Print week</button>
      </div>

      {loading && <div className="empty">Loading production plan…</div>}

      {plan && !loading && (
        <div className="production-panel">
          <div className="production-summary">
            <div><strong>{plan.productionDays}</strong><span>Production days</span></div>
            <div><strong>{plan.totalDishes}</strong><span>Total dishes</span></div>
            <div><strong>{plan.advanceItems}</strong><span>Advance prep items</span></div>
            <div><strong>{plan.phaseLabel}</strong><span>Cycle phase</span></div>
          </div>

          <div className="prod-section">
            <div className="prod-section-head">
              <span className="psh-title">Dinner protein rotation — Week {plan.weekNumber}</span>
              <span className="cell-muted">No protein should repeat inside the window</span>
            </div>
            <div className="rotation-strip">
              {plan.dinnerRotation.map((entry) => (
                <div className="rotation-cell" key={entry.dayNumber}>
                  <div className="rotation-day">Day {entry.dayNumber}</div>
                  <div className="rotation-protein">{entry.protein}</div>
                </div>
              ))}
            </div>
          </div>

          {plan.days.map((day) => (
            <div className="prod-day" key={day.dayNumber}>
              <div className="prod-day-head">
                <span className="adg-daynum">Day {String(day.dayNumber).padStart(2, "0")}</span>
                <span className="cell-muted">{day.date ?? "date not set"} · {day.phaseLabel}</span>
                <button className="btn btn-ghost btn-small" onClick={() => onConsume(day.dayNumber)}>
                  Record production
                </button>
              </div>
              {day.meals.map((meal) =>
                meal.assigned ? (
                  <div className="production-row" key={meal.mealType}>
                    <span className={`meal-tag meal-${meal.mealType.toLowerCase()}`}>
                      {MEAL_NAMES[meal.mealType]}
                    </span>
                    <div>
                      <div className="pr-title">{meal.title}</div>
                      {meal.subtitle && <div className="cell-muted">{meal.subtitle}</div>}
                      {meal.advance.map((item, index) => (
                        <div className="pr-advance" key={index}>⏰ {item}</div>
                      ))}
                    </div>
                    <span className="pr-protein">{meal.protein}</span>
                    <small>{meal.kcal ?? "—"} kcal · {meal.proteinGrams ?? "—"}g protein</small>
                    <small>×{meal.servings}</small>
                  </div>
                ) : (
                  <div className="production-row production-row-empty" key={meal.mealType}>
                    <span className={`meal-tag meal-${meal.mealType.toLowerCase()}`}>
                      {MEAL_NAMES[meal.mealType]}
                    </span>
                    <div className="cell-muted">Unassigned</div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
