"use client";

import { MEAL_LABELS, type RecipeListItem } from "./types";

/** The kitchen execution card. */
export function RecipeCard({
  recipe,
  onPublish,
  publishing,
}: {
  recipe: RecipeListItem;
  onPublish: () => void;
  publishing: boolean;
}) {
  const version = recipe.latestVersion;
  const isDraft = version.status === "DRAFT";

  return (
    <article className="recipe-card-dark">
      <div className="recipe-card-header">
        <div className="recipe-meta-top">
          <span>
            v{version.versionNumber} · {version.status}
            {version.publishedAt && ` · published ${version.publishedAt.slice(0, 10)}`}
          </span>
          <span className={`recipe-meal-badge recipe-badge-${recipe.mealType.toLowerCase()}`}>
            {MEAL_LABELS[recipe.mealType] ?? recipe.mealType}
          </span>
        </div>
        <h1>{recipe.title}</h1>
        <p>{recipe.subtitle ?? "Kitchen execution card"}</p>

        {isDraft && (
          <div className="draft-banner">
            <span>
              This version is a draft. It cannot be assigned to a cycle until it is published.
            </span>
            <button className="recipe-btn recipe-btn-copper" onClick={onPublish} disabled={publishing}>
              {publishing ? "Publishing…" : "Publish version"}
            </button>
          </div>
        )}
      </div>

      <div className="recipe-stats-dark">
        <Stat value={version.calories ?? "—"} label="Kcal" />
        <Stat value={version.proteinGrams ? `${version.proteinGrams}g` : "—"} label="Protein" />
        <Stat value={version.carbsGrams ? `${version.carbsGrams}g` : "—"} label="Carbs" />
        <Stat value={version.fatGrams ? `${version.fatGrams}g` : "—"} label="Fat" />
        <Stat value={version.ingredients.length} label="Ingredients" />
        <Stat value={version.steps.length} label="Steps" />
      </div>

      <div className="recipe-card-body">
        <div className="ingredients-dark">
          <div className="recipe-panel-title">Ingredients — 1 serving</div>
          {version.ingredients.length ? (
            version.ingredients.map((ingredient) => (
              <div key={ingredient.id}>
                <div className="recipe-ingredient-row">
                  <span>{ingredient.name}</span>
                  <b>{ingredient.quantity} {ingredient.unit}</b>
                </div>
                {ingredient.note && <div className="recipe-ingredient-note">{ingredient.note}</div>}
              </div>
            ))
          ) : (
            <div className="recipe-muted">No ingredients recorded.</div>
          )}
        </div>

        <div className="method-dark">
          <div className="recipe-panel-title">Method — key steps</div>
          {version.steps.length ? (
            version.steps.map((step) => (
              <div className="recipe-method-step" key={step.id}>
                <div className="recipe-step-number">{String(step.stepNumber).padStart(2, "0")}</div>
                <div>
                  <div className="recipe-step-title">{step.title}</div>
                  <div className="recipe-step-text">{step.instructions}</div>
                  {step.temperatureC !== null && (
                    <span className="recipe-step-crit recipe-crit-temp">🌡 {step.temperatureC}°C</span>
                  )}
                  {step.durationMinutes !== null && (
                    <span className="recipe-step-crit recipe-crit-time">⏱ {step.durationMinutes} min</span>
                  )}
                  {step.criticality !== "info" && (
                    <span className="recipe-step-crit recipe-crit-warn">⚠ {step.criticality}</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="recipe-muted">No method steps recorded.</div>
          )}
        </div>
      </div>

      <div className="recipe-card-footer">
        <div className="recipe-footer-block">
          <div className="recipe-footer-title">Allergens</div>
          <div className="recipe-allergen-flags">
            {version.allergens.length ? (
              version.allergens.map((allergen) => (
                <span className="recipe-allergen" key={allergen}>{allergen}</span>
              ))
            ) : (
              <span className="recipe-allergen recipe-allergen-none">No major allergens</span>
            )}
          </div>
        </div>

        <div className="recipe-footer-block">
          <div className="recipe-footer-title">Advance Prep Required</div>
          {version.advance.length ? (
            version.advance.map((item, index) => (
              <div className="recipe-advance-item" key={index}><i />{item}</div>
            ))
          ) : (
            <div className="recipe-muted">No advance prep required</div>
          )}
        </div>

        <div className="recipe-footer-block">
          <div className="recipe-footer-title">Plating Notes</div>
          <div className="recipe-plating">{version.platingNotes ?? "No plating notes recorded."}</div>
        </div>
      </div>
    </article>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}
