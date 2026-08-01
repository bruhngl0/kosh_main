import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { toNullableNumber, toNumber } from "@/shared/money";

/** Recipe read models — the execution card and the browser. */

const versionInclude = {
  ingredients: {
    include: { ingredient: { select: { id: true, name: true, defaultUnit: true } } },
  },
  steps: { orderBy: { stepNumber: "asc" } },
  allergens: true,
} satisfies Prisma.RecipeVersionInclude;

export type RecipeVersionView = ReturnType<typeof toVersionView>;

export async function listRecipes(filter: {
  search?: string;
  mealType?: string;
  status?: string;
  includeArchived?: boolean;
} = {}) {
  const recipes = await db.recipe.findMany({
    where: {
      ...(filter.includeArchived ? {} : { active: true }),
      ...(filter.mealType ? { mealType: filter.mealType as never } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: "insensitive" } },
              { subtitle: { contains: filter.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      versions: {
        // When a status filter is supplied, show the newest matching version;
        // otherwise the newest version of any status.
        where: filter.status ? { status: filter.status as never } : undefined,
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: versionInclude,
      },
    },
    orderBy: { title: "asc" },
  });

  return recipes
    .filter((recipe) => recipe.versions.length > 0)
    .map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      subtitle: recipe.subtitle,
      mealType: recipe.mealType,
      active: recipe.active,
      latestVersion: toVersionView(recipe.versions[0]),
    }));
}

export async function getRecipe(id: string) {
  const recipe = await db.recipe.findUnique({
    where: { id },
    include: { versions: { orderBy: { versionNumber: "desc" }, include: versionInclude } },
  });
  if (!recipe) throw notFound("Recipe", id);

  return {
    id: recipe.id,
    title: recipe.title,
    subtitle: recipe.subtitle,
    mealType: recipe.mealType,
    active: recipe.active,
    createdAt: recipe.createdAt.toISOString(),
    versions: recipe.versions.map(toVersionView),
  };
}

export async function getRecipeVersion(id: string) {
  const version = await db.recipeVersion.findUnique({
    where: { id },
    include: { ...versionInclude, recipe: true },
  });
  if (!version) throw notFound("Recipe version", id);

  return {
    ...toVersionView(version),
    recipe: {
      id: version.recipe.id,
      title: version.recipe.title,
      subtitle: version.recipe.subtitle,
      mealType: version.recipe.mealType,
      active: version.recipe.active,
    },
  };
}

/** Options for the planner's slot picker — published versions only (BR-4). */
export async function listAssignableVersions(mealType?: string) {
  const recipes = await db.recipe.findMany({
    where: { active: true, ...(mealType ? { mealType: mealType as never } : {}) },
    include: {
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, versionNumber: true, proteinSource: true, calories: true, proteinGrams: true },
      },
    },
    orderBy: { title: "asc" },
  });

  return recipes.flatMap((recipe) => {
    const version = recipe.versions[0];
    if (!version) return [];
    return [
      {
        recipeVersionId: version.id,
        recipeId: recipe.id,
        title: recipe.title,
        subtitle: recipe.subtitle,
        mealType: recipe.mealType,
        versionNumber: version.versionNumber,
        proteinSource: version.proteinSource,
        calories: toNullableNumber(version.calories),
        proteinGrams: toNullableNumber(version.proteinGrams),
      },
    ];
  });
}

function toVersionView(
  version: Prisma.RecipeVersionGetPayload<{ include: typeof versionInclude }>,
) {
  const steps = version.steps.map((step) => ({
    id: step.id,
    stepNumber: step.stepNumber,
    title: step.title,
    instructions: step.instructions,
    temperatureC: toNullableNumber(step.temperatureC),
    durationMinutes: step.durationMinutes,
    criticality: step.criticality,
  }));

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    editable: version.status === "DRAFT",
    calories: toNullableNumber(version.calories),
    proteinGrams: toNullableNumber(version.proteinGrams),
    carbsGrams: toNullableNumber(version.carbsGrams),
    fatGrams: toNullableNumber(version.fatGrams),
    proteinSource: version.proteinSource,
    platingNotes: version.platingNotes,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    ingredients: version.ingredients.map((item) => ({
      id: item.id,
      ingredientId: item.ingredientId,
      name: item.ingredient.name,
      quantity: toNumber(item.quantity),
      unit: item.unit,
      note: item.preparationNote,
    })),
    steps,
    // Advance prep is the non-info subset, which is exactly what drives
    // prep-task generation (BR-3).
    advance: steps.filter((step) => step.criticality !== "info").map((step) => step.instructions),
    allergens: version.allergens.map((allergen) => allergen.allergenCode),
  };
}
