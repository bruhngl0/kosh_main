"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api-client";
import { ActionMessage, useFeedback } from "@/components/ui/action-message";
import { NewRecipeForm } from "./new-recipe-form";
import { RecipeCard } from "./recipe-card";
import type { RecipeListItem } from "./types";

const FILTERS: [string, string][] = [
  ["ALL", "All"],
  ["BF", "Breakfast"],
  ["SN", "Snack"],
  ["LU", "Lunch"],
  ["DI", "Dinner"],
];

export function RecipeDatabase({ recipes: initialRecipes }: { recipes: RecipeListItem[] }) {
  const router = useRouter();
  const { feedback, succeed, fail, clear } = useFeedback();

  const [recipes, setRecipes] = useState(initialRecipes);
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
    <main className="recipe-db-page">
      <header className="recipe-db-header">
        <div className="recipe-brand-group">
          <div className="recipe-logo">Kō<sup>sh</sup></div>
          <div className="recipe-header-rule" />
          <div className="recipe-header-meta">
            Recipe Card Database · {recipes.length} recipes
            {draftCount > 0 && ` · ${draftCount} draft${draftCount === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="recipe-header-actions">
          <button className="recipe-btn recipe-btn-ghost" onClick={() => window.print()}>Print Card</button>
          <button
            className="recipe-btn recipe-btn-ghost"
            disabled={currentIndex <= 0}
            onClick={() => setActiveId(filtered[currentIndex - 1].id)}
          >
            ← Prev
          </button>
          <button
            className="recipe-btn recipe-btn-ghost"
            disabled={currentIndex < 0 || currentIndex >= filtered.length - 1}
            onClick={() => setActiveId(filtered[currentIndex + 1].id)}
          >
            Next →
          </button>
          <button
            className="recipe-btn recipe-btn-ghost"
            onClick={() => recipes.length && setActiveId(recipes[Math.floor(Math.random() * recipes.length)].id)}
          >
            Random
          </button>
          <button className="recipe-btn recipe-btn-copper" onClick={() => setShowCreate(true)}>+ Recipe</button>
        </div>
      </header>

      <ActionMessage feedback={feedback} onDismiss={clear} />

      <div className="recipe-db-layout">
        <aside className="recipe-db-sidebar">
          <div className="recipe-db-search">
            <input
              className="recipe-search-input"
              placeholder="Search recipes…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="recipe-filter-row">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                className={`recipe-filter-pill ${mealFilter === id ? "active" : ""}`}
                onClick={() => setMealFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="recipe-filter-row">
            {[["ALL", "Any status"], ["PUBLISHED", "Published"], ["DRAFT", "Draft"]].map(([id, label]) => (
              <button
                key={id}
                className={`recipe-filter-pill ${statusFilter === id ? "active" : ""}`}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="recipe-meal-list">
            {filtered.length === 0 && <div className="recipe-no-match">No recipes match.</div>}
            {filtered.map((recipe) => (
              <button
                className={`recipe-meal-item ${recipe.id === current?.id ? "active" : ""}`}
                key={recipe.id}
                onClick={() => setActiveId(recipe.id)}
              >
                <i className={`recipe-meal-dot recipe-dot-${recipe.mealType.toLowerCase()}`} />
                <span>{recipe.title}</span>
                {recipe.latestVersion.status === "DRAFT" && <small className="draft-pill">draft</small>}
              </button>
            ))}
          </div>
        </aside>

        <section className="recipe-db-main">
          {current ? (
            <RecipeCard recipe={current} onPublish={() => void publish(current)} publishing={publishing} />
          ) : (
            <div className="recipe-empty">
              <div className="recipe-empty-icon">01</div>
              <div>Select a recipe from the sidebar</div>
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <NewRecipeForm
          onClose={() => setShowCreate(false)}
          onCreated={(message) => {
            setShowCreate(false);
            succeed(message);
            router.refresh();
          }}
          onError={fail}
        />
      )}
    </main>
  );
}
