"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api-client";
import { createRecipeSchema } from "@/shared/schemas/recipe";

type IngredientOption = { id: string; name: string; defaultUnit: string };
type IngredientRow = { ingredientName: string; quantity: string; unit: string; preparationNote: string };
type StepRow = {
  title: string;
  instructions: string;
  criticalNotes: string;
  temperatureC: string;
  durationMinutes: string;
  criticality: "info" | "warning" | "mandatory";
};

const blankIngredient = (): IngredientRow => ({ ingredientName: "", quantity: "", unit: "", preparationNote: "" });
const blankStep = (): StepRow => ({
  title: "",
  instructions: "",
  criticalNotes: "",
  temperatureC: "",
  durationMinutes: "",
  criticality: "info",
});

export function NewRecipeForm({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (message: string, recipeId: string) => void;
  onError: (message: string) => void;
}) {
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([blankIngredient()]);
  const [steps, setSteps] = useState<StepRow[]>([blankStep()]);
  const [allergens, setAllergens] = useState("");
  const [advance, setAdvance] = useState("");
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<IngredientOption[]>("/ingredients", controller.signal)
      .then(setIngredients)
      .catch(() => {
        // Suggestions are a convenience; the form still works without them.
      });
    return () => controller.abort();
  }, []);

  const updateIngredient = (index: number, patch: Partial<IngredientRow>) =>
    setIngredientRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const updateStep = (index: number, patch: Partial<StepRow>) =>
    setSteps((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(form: HTMLFormElement) {
    setError("");
    const data = new FormData(form);
    const number = (key: string) => {
      const raw = data.get(key);
      return raw === null || raw === "" ? undefined : Number(raw);
    };

    const payload = {
      title: data.get("title"),
      subtitle: data.get("subtitle") || undefined,
      mealType: data.get("mealType"),
      proteinSource: data.get("proteinSource") || undefined,
      calories: number("calories"),
      proteinGrams: number("proteinGrams"),
      carbsGrams: number("carbsGrams"),
      fatGrams: number("fatGrams"),
      platingNotes: data.get("platingNotes") || undefined,
      publish,
      allergens: allergens.split(",").map((item) => item.trim()).filter(Boolean),
      advance: advance.split("\n").map((item) => item.trim()).filter(Boolean),
      ingredients: ingredientRows
        .filter((row) => row.ingredientName || row.quantity)
        .map((row) => ({
          ingredientName: row.ingredientName,
          quantity: Number(row.quantity),
          unit: row.unit,
          preparationNote: row.preparationNote || undefined,
        })),
      steps: steps
        .filter((row) => row.title || row.instructions)
        .map((row, index) => ({
          stepNumber: index + 1,
          title: row.title,
          instructions: [row.instructions, row.criticalNotes ? `Critical note: ${row.criticalNotes}` : ""]
            .filter(Boolean)
            .join("\n"),
          temperatureC: row.temperatureC === "" ? undefined : Number(row.temperatureC),
          durationMinutes: row.durationMinutes === "" ? undefined : Number(row.durationMinutes),
          criticality: row.criticality,
        })),
    };

    // Same schema the route handler re-validates with (§4.2).
    const parsed = createRecipeSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please complete the required fields.");
      return;
    }

    setSaving(true);
    try {
      const recipe = await api.post<{ id: string }>("/recipes", parsed.data);
      onCreated(
        publish
          ? "Recipe created and published — it can now be assigned to a cycle."
          : "Recipe saved as a draft. Publish it before assigning it to a cycle.",
        recipe.id,
      );
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="New recipe"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="form-modal form-modal-wide recipe-form-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="modal-head">
          <div>
            <h2>New Recipe</h2>
            <small className="form-intro">Complete kitchen execution card</small>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="recipe-form-error">{error}</div>}

          <section className="recipe-form-section">
            <div className="recipe-form-section-title">Recipe identity</div>
            <div className="recipe-form-grid">
              <label>Title *<input name="title" className="recipe-form-input" required placeholder="e.g. Miso-glazed salmon" /></label>
              <label>
                Meal *
                <select name="mealType" className="recipe-form-input" defaultValue="BF">
                  <option value="BF">Breakfast</option>
                  <option value="SN">Snack</option>
                  <option value="LU">Lunch</option>
                  <option value="DI">Dinner</option>
                </select>
              </label>
              <label>Subtitle<input name="subtitle" className="recipe-form-input" placeholder="e.g. Bok choy · sesame-ginger dressing" /></label>
              <label>Protein source<input name="proteinSource" className="recipe-form-input" placeholder="salmon, chicken, plant…" /></label>
            </div>
            <p className="recipe-form-help">
              Day and week placement are set when the recipe is assigned from the Cycle Planner.
            </p>
          </section>

          <section className="recipe-form-section">
            <div className="recipe-form-section-title">Nutrition per serving</div>
            <div className="recipe-form-grid recipe-form-grid-four">
              {[["calories", "Kcal"], ["proteinGrams", "Protein (g)"], ["carbsGrams", "Carbs (g)"], ["fatGrams", "Fat (g)"]].map(
                ([name, label]) => (
                  <label key={name}>
                    {label}
                    <input name={name} className="recipe-form-input" type="number" min="0" step="0.01" placeholder="—" />
                  </label>
                ),
              )}
            </div>
          </section>

          <section className="recipe-form-section">
            <div className="recipe-form-section-title recipe-form-section-row">
              <span>Ingredients — quantity for one serving</span>
              <button type="button" className="recipe-form-add" onClick={() => setIngredientRows((rows) => [...rows, blankIngredient()])}>
                + Add ingredient
              </button>
            </div>
            {ingredientRows.map((row, index) => (
              <div className="recipe-line-grid recipe-line-grid-recipe" key={index}>
                <input
                  className="recipe-form-input"
                  list="recipe-ingredient-options"
                  placeholder="Ingredient name"
                  value={row.ingredientName}
                  onChange={(event) => {
                    const match = ingredients.find((item) => item.name === event.target.value);
                    updateIngredient(index, {
                      ingredientName: event.target.value,
                      ...(match && !row.unit ? { unit: match.defaultUnit } : {}),
                    });
                  }}
                />
                <input
                  className="recipe-form-input"
                  type="number"
                  min="0.001"
                  step="0.001"
                  placeholder="Qty"
                  value={row.quantity}
                  onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
                />
                <input
                  className="recipe-form-input"
                  placeholder="Unit"
                  value={row.unit}
                  onChange={(event) => updateIngredient(index, { unit: event.target.value })}
                />
                <input
                  className="recipe-form-input"
                  placeholder="Preparation note"
                  value={row.preparationNote}
                  onChange={(event) => updateIngredient(index, { preparationNote: event.target.value })}
                />
                <button
                  type="button"
                  className="recipe-form-remove"
                  aria-label="Remove ingredient"
                  onClick={() =>
                    setIngredientRows((rows) =>
                      rows.length === 1 ? [blankIngredient()] : rows.filter((_, i) => i !== index),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <datalist id="recipe-ingredient-options">
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.name}>{ingredient.defaultUnit}</option>
              ))}
            </datalist>
          </section>

          <section className="recipe-form-section">
            <div className="recipe-form-section-title recipe-form-section-row">
              <span>Method steps</span>
              <button type="button" className="recipe-form-add" onClick={() => setSteps((rows) => [...rows, blankStep()])}>
                + Add step
              </button>
            </div>
            <p className="recipe-form-help">
              Steps marked <strong>warning</strong> or <strong>mandatory</strong> become advance-prep tasks. Write the
              lead time into the instruction — &ldquo;24hr prior&rdquo;, &ldquo;3 days prior&rdquo;, &ldquo;overnight&rdquo; — and it is scheduled
              automatically.
            </p>
            {steps.map((row, index) => (
              <div className="recipe-step-form-row recipe-step-form-row-complete" key={index}>
                <div className="recipe-step-index">{String(index + 1).padStart(2, "0")}</div>
                <input className="recipe-form-input" placeholder="Step title" value={row.title} onChange={(event) => updateStep(index, { title: event.target.value })} />
                <textarea className="recipe-form-input recipe-form-textarea" placeholder="Instructions" value={row.instructions} onChange={(event) => updateStep(index, { instructions: event.target.value })} />
                <input className="recipe-form-input" type="number" placeholder="°C" value={row.temperatureC} onChange={(event) => updateStep(index, { temperatureC: event.target.value })} />
                <input className="recipe-form-input" type="number" min="1" placeholder="Min" value={row.durationMinutes} onChange={(event) => updateStep(index, { durationMinutes: event.target.value })} />
                <select className="recipe-form-input" value={row.criticality} onChange={(event) => updateStep(index, { criticality: event.target.value as StepRow["criticality"] })}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="mandatory">Mandatory</option>
                </select>
                <input className="recipe-form-input recipe-critical-note" placeholder="Critical note" value={row.criticalNotes} onChange={(event) => updateStep(index, { criticalNotes: event.target.value })} />
                <button
                  type="button"
                  className="recipe-form-remove"
                  aria-label="Remove step"
                  onClick={() => setSteps((rows) => (rows.length === 1 ? [blankStep()] : rows.filter((_, i) => i !== index)))}
                >
                  ×
                </button>
              </div>
            ))}
          </section>

          <section className="recipe-form-section">
            <div className="recipe-form-grid">
              <label>
                Allergens
                <input className="recipe-form-input" value={allergens} onChange={(event) => setAllergens(event.target.value)} placeholder="Egg, Gluten, Dairy (comma separated)" />
              </label>
              <label>
                Advance prep
                <textarea className="recipe-form-input recipe-form-textarea" value={advance} onChange={(event) => setAdvance(event.target.value)} placeholder="One requirement per line, e.g. Marinate 24hr prior" />
              </label>
              <label>
                Plating notes
                <textarea name="platingNotes" className="recipe-form-input recipe-form-textarea" placeholder="Service and plating guidance" />
              </label>
            </div>
          </section>
        </div>

        <div className="modal-footer recipe-form-actions">
          <label className="toggle-label">
            <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
            Publish immediately
          </label>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-copper" type="submit" disabled={saving}>
            {saving ? "Saving…" : publish ? "Create & publish" : "Save as draft"}
          </button>
        </div>
      </form>
    </div>
  );
}
