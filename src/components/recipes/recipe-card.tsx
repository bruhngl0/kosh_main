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
    <article className="recipes-card">
      <header className="recipes-card-head">
        <div className="recipes-card-meta">
          <span className={`recipes-meal-badge recipes-badge-${recipe.mealType.toLowerCase()}`}>
            {MEAL_LABELS[recipe.mealType] ?? recipe.mealType}
          </span>
          <span>
            v{version.versionNumber} · {version.status.toLowerCase()}
            {version.publishedAt && ` · published ${version.publishedAt.slice(0, 10)}`}
          </span>
        </div>
        <h2>{recipe.title}</h2>
        <p>{recipe.subtitle ?? "Kitchen execution card"}</p>

        {isDraft && (
          <div className="draft-banner">
            <span>This version is a draft. It cannot be assigned to a cycle until it is published.</span>
            <button className="btn btn-copper btn-small" onClick={onPublish} disabled={publishing}>
              {publishing ? "Publishing…" : "Publish version"}
            </button>
          </div>
        )}
      </header>

      <div className="recipes-stats">
        <Stat value={version.calories ?? "—"} label="Kcal" />
        <Stat value={version.proteinGrams ? `${version.proteinGrams}g` : "—"} label="Protein" />
        <Stat value={version.carbsGrams ? `${version.carbsGrams}g` : "—"} label="Carbs" />
        <Stat value={version.fatGrams ? `${version.fatGrams}g` : "—"} label="Fat" />
        <Stat value={version.ingredients.length} label="Ingredients" />
        <Stat value={version.steps.length} label="Steps" />
      </div>

      <div className="recipes-body">
        <div>
          <h3 className="recipes-section-title">Ingredients — 1 serving</h3>
          {version.ingredients.length ? (
            version.ingredients.map((ingredient) => (
              <div className="recipes-ingredient" key={ingredient.id}>
                <div className="recipes-ingredient-row">
                  <span>{ingredient.name}</span>
                  <b>
                    {ingredient.quantity} {ingredient.unit}
                  </b>
                </div>
                {ingredient.note && <small>{ingredient.note}</small>}
              </div>
            ))
          ) : (
            <div className="empty-note">No ingredients recorded.</div>
          )}
        </div>

        <div>
          <h3 className="recipes-section-title">Method — key steps</h3>
          {version.steps.length ? (
            version.steps.map((step) => (
              <div className="recipes-step" key={step.id}>
                <div className="recipes-step-number">{String(step.stepNumber).padStart(2, "0")}</div>
                <div>
                  <div className="recipes-step-title">{step.title}</div>
                  <div className="recipes-step-text">{step.instructions}</div>
                  {(step.temperatureC !== null || step.durationMinutes !== null || step.criticality !== "info") && (
                    <div className="recipes-step-tags">
                      {step.temperatureC !== null && <span className="recipes-tag tag-temp">🌡 {step.temperatureC}°C</span>}
                      {step.durationMinutes !== null && (
                        <span className="recipes-tag tag-time">⏱ {step.durationMinutes} min</span>
                      )}
                      {step.criticality !== "info" && <span className="recipes-tag tag-warn">⚠ {step.criticality}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-note">No method steps recorded.</div>
          )}
        </div>
      </div>

      <footer className="recipes-footer">
        <div>
          <h3 className="recipes-section-title">Allergens</h3>
          <div className="recipes-allergens">
            {version.allergens.length ? (
              version.allergens.map((allergen) => (
                <span className="recipes-allergen" key={allergen}>
                  {allergen}
                </span>
              ))
            ) : (
              <span className="recipes-allergen recipes-allergen-none">No major allergens</span>
            )}
          </div>
        </div>

        <div>
          <h3 className="recipes-section-title">Advance prep required</h3>
          {version.advance.length ? (
            <ul className="recipes-advance">
              {version.advance.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="recipes-muted">No advance prep required.</p>
          )}
        </div>

        <div>
          <h3 className="recipes-section-title">Plating notes</h3>
          <p className={version.platingNotes ? "recipes-plating" : "recipes-muted"}>
            {version.platingNotes ?? "No plating notes recorded."}
          </p>
        </div>
      </footer>
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
