"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import { Kpi } from "@/components/inventory/panels";
import { NewRecipeForm } from "./new-recipe-form";
import { RecipeCard } from "./recipe-card";
import type { RecipeListItem } from "./types";

const MEAL_FILTERS: [string, string][] = [
  ["ALL", "All"],
  ["BF", "Breakfast"],
  ["SN", "Snack"],
  ["LU", "Lunch"],
  ["DI", "Dinner"],
];

const STATUS_FILTERS: [string, string][] = [
  ["ALL", "Any status"],
  ["PUBLISHED", "Published"],
  ["DRAFT", "Draft"],
];

export function RecipeDatabase({ recipes: initialRecipes }: { recipes: RecipeListItem[] }) {
  const router = useRouter();
  const { feedback, succeed, fail, clear } = useFeedback();

  const [recipes, setRecipes] = useState(initialRecipes);
  // router.refresh() re-renders the server page with fresh props; adopt them so
  // a newly created recipe shows up without a full reload.
  const [syncedFrom, setSyncedFrom] = useState(initialRecipes);
  if (initialRecipes !== syncedFrom) {
    setSyncedFrom(initialRecipes);
    setRecipes(initialRecipes);
  }
  const [search, setSearch] = useState("");
  const [mealFilter, setMealFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [activeId, setActiveId] = useState(initialRecipes[0]?.id ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const filtered = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          (mealFilter === "ALL" || recipe.mealType === mealFilter) &&
          (statusFilter === "ALL" || recipe.latestVersion.status === statusFilter) &&
          (!search ||
            `${recipe.title} ${recipe.subtitle ?? ""}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [recipes, search, mealFilter, statusFilter],
  );

  const current = filtered.find((recipe) => recipe.id === activeId) ?? filtered[0] ?? null;
  const currentIndex = current ? filtered.findIndex((recipe) => recipe.id === current.id) : -1;

  const draftCount = recipes.filter((recipe) => recipe.latestVersion.status === "DRAFT").length;
  const publishedCount = recipes.filter((recipe) => recipe.latestVersion.status === "PUBLISHED").length;
  const allergenFree = recipes.filter((recipe) => recipe.latestVersion.allergens.length === 0).length;
  const mealCount = (id: string) =>
    id === "ALL" ? recipes.length : recipes.filter((recipe) => recipe.mealType === id).length;

  async function publish(recipe: RecipeListItem) {
    setPublishing(true);
    try {
      await api.post(`/recipe-versions/${recipe.latestVersion.id}/publish`);
      setRecipes((current) =>
        current.map((item) =>
          item.id === recipe.id
            ? { ...item, latestVersion: { ...item.latestVersion, status: "PUBLISHED", editable: false } }
            : item,
        ),
      );
      succeed(`"${recipe.title}" published — it can now be assigned to a cycle.`);
      router.refresh();
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="inventory-page recipes-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Recipes · Kōsh Private Kitchen · Sadashivanagar</div>
          <h1>Recipe Database</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => window.print()} disabled={!current}>
            Print card
          </button>
          <button className="btn btn-copper" onClick={() => setShowCreate(true)}>
            + Recipe
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Recipes" value={String(recipes.length)} sub="in the library" />
        <Kpi label="Published" value={String(publishedCount)} sub="assignable to a cycle" />
        <Kpi
          label="Drafts"
          value={String(draftCount)}
          sub={draftCount ? "publish before assigning" : "nothing waiting"}
        />
        <Kpi label="Allergen-free" value={String(allergenFree)} sub="no major allergens" />
      </div>

      <div className="inventory-tabs">
        {MEAL_FILTERS.map(([id, label]) => (
          <button key={id} className={mealFilter === id ? "active" : ""} onClick={() => setMealFilter(id)}>
            {label}
            <span className="subscribers-count">{mealCount(id)}</span>
          </button>
        ))}
      </div>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      <div className="recipes-layout">
        <aside className="inventory-card recipes-sidebar">
          <div className="card-toolbar recipes-sidebar-toolbar">
            <input
              className="search"
              type="search"
              placeholder="Search recipes…"
              aria-label="Search recipes"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="category-pills">
              {STATUS_FILTERS.map(([id, label]) => (
                <button key={id} className={statusFilter === id ? "active" : ""} onClick={() => setStatusFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="recipes-list">
            {filtered.length === 0 && <div className="recipes-empty-list">No recipes match.</div>}
            {filtered.map((recipe) => (
              <button
                className={`recipes-list-item ${recipe.id === current?.id ? "active" : ""}`}
                key={recipe.id}
                onClick={() => setActiveId(recipe.id)}
              >
                <i className={`recipes-dot recipes-dot-${recipe.mealType.toLowerCase()}`} />
                <span>{recipe.title}</span>
                {recipe.latestVersion.status === "DRAFT" && <small className="draft-pill">draft</small>}
              </button>
            ))}
          </div>
        </aside>

        <section className="inventory-card recipes-main">
          <div className="card-toolbar recipes-main-toolbar">
            <h2>{current ? `Recipe ${currentIndex + 1} of ${filtered.length}` : "No recipe selected"}</h2>
            <div className="header-actions">
              <button
                className="btn btn-ghost btn-small"
                disabled={currentIndex <= 0}
                onClick={() => setActiveId(filtered[currentIndex - 1].id)}
              >
                ← Prev
              </button>
              <button
                className="btn btn-ghost btn-small"
                disabled={currentIndex < 0 || currentIndex >= filtered.length - 1}
                onClick={() => setActiveId(filtered[currentIndex + 1].id)}
              >
                Next →
              </button>
              <button
                className="btn btn-ghost btn-small"
                disabled={!filtered.length}
                onClick={() => setActiveId(filtered[Math.floor(Math.random() * filtered.length)].id)}
              >
                Random
              </button>
            </div>
          </div>

          {current ? (
            <RecipeCard recipe={current} onPublish={() => void publish(current)} publishing={publishing} />
          ) : (
            <div className="empty-state">
              {recipes.length ? "Select a recipe from the list." : "No recipes yet. Add the first one with + Recipe."}
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <NewRecipeForm
          onClose={() => setShowCreate(false)}
          onCreated={(message, recipeId) => {
            setShowCreate(false);
            setSearch("");
            setMealFilter("ALL");
            setStatusFilter("ALL");
            setActiveId(recipeId);
            succeed(message);
            router.refresh();
          }}
          onError={fail}
        />
      )}
    </main>
  );
}
