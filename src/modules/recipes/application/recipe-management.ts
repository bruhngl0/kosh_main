import type { Prisma } from "@prisma/client";
import { db, type DbClient } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";
import { normaliseIngredientName } from "@/shared/schemas/common";
import type {
  CreateRecipeInput,
  CreateRecipeVersionInput,
  RecipeIngredientInput,
  RecipeStepInput,
  UpdateRecipeInput,
  UpdateRecipeVersionInput,
} from "@/shared/schemas/recipe";

/**
 * Recipe and version management. See BR-15.
 *
 * The previous implementation always created version 1 as a DRAFT, while every
 * reader filtered for PUBLISHED — so a recipe created through the UI was
 * permanently invisible and could never be assigned. Creation now accepts a
 * `publish` flag, and there is an explicit publish endpoint.
 */

type Context = { actor: Actor; requestId: string };

export async function createRecipe(input: CreateRecipeInput, context: Context) {
  assertCan(context.actor, "recipes:write");

  const duplicate = await db.recipe.findUnique({
    where: { title_mealType: { title: input.title, mealType: input.mealType } },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`A ${input.mealType} recipe called "${input.title}" already exists.`, {
      recipeId: duplicate.id,
    });
  }

  return db.$transaction(async (tx) => {
    const recipe = await tx.recipe.create({
      data: { title: input.title, subtitle: input.subtitle, mealType: input.mealType },
    });

    const version = await tx.recipeVersion.create({
      data: {
        recipeId: recipe.id,
        versionNumber: 1,
        status: input.publish ? "PUBLISHED" : "DRAFT",
        publishedAt: input.publish ? new Date() : null,
        createdById: context.actor.id,
        calories: input.calories,
        proteinGrams: input.proteinGrams,
        carbsGrams: input.carbsGrams,
        fatGrams: input.fatGrams,
        proteinSource: input.proteinSource,
        platingNotes: input.platingNotes,
      },
    });

    await writeVersionContent(tx, version.id, input);

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recipe.created",
      entityType: "Recipe",
      entityId: recipe.id,
      after: { ...recipe, versionId: version.id, published: input.publish },
      requestId: context.requestId,
    });

    return loadRecipe(tx, recipe.id);
  });
}

export async function updateRecipe(id: string, input: UpdateRecipeInput, context: Context) {
  assertCan(context.actor, "recipes:write");

  const before = await db.recipe.findUnique({ where: { id } });
  if (!before) throw notFound("Recipe", id);

  return db.$transaction(async (tx) => {
    const after = await tx.recipe.update({
      where: { id },
      data: { title: input.title, subtitle: input.subtitle, active: input.active },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recipe.updated",
      entityType: "Recipe",
      entityId: id,
      before,
      after,
      requestId: context.requestId,
    });

    return loadRecipe(tx, id);
  });
}

export async function archiveRecipe(id: string, context: Context) {
  assertCan(context.actor, "recipes:write");

  const recipe = await db.recipe.findUnique({ where: { id }, select: { id: true, active: true, title: true } });
  if (!recipe) throw notFound("Recipe", id);

  // A recipe still on a live menu must not vanish from under the kitchen.
  const inUse = await db.mealAssignment.count({
    where: {
      recipeVersion: { recipeId: id },
      cycleDay: { cycle: { status: { in: ["ACTIVE", "CLOSED"] } } },
    },
  });
  if (inUse > 0) {
    throw unprocessable(`"${recipe.title}" is assigned in ${inUse} published cycle slot(s) and cannot be archived.`, {
      assignments: inUse,
    });
  }

  return db.$transaction(async (tx) => {
    await tx.recipe.update({ where: { id }, data: { active: false } });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recipe.archived",
      entityType: "Recipe",
      entityId: id,
      before: { active: recipe.active },
      after: { active: false },
      requestId: context.requestId,
    });
    return { id, archived: true };
  });
}

// ── Versions (BR-15) ─────────────────────────────────────────────────────────

export async function createRecipeVersion(
  recipeId: string,
  input: CreateRecipeVersionInput,
  context: Context,
) {
  assertCan(context.actor, "recipes:write");

  const recipe = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { versionNumber: true } } },
  });
  if (!recipe) throw notFound("Recipe", recipeId);

  const nextVersionNumber = (recipe.versions[0]?.versionNumber ?? 0) + 1;

  return db.$transaction(async (tx) => {
    const source = input.cloneFromVersionId
      ? await tx.recipeVersion.findUnique({
          where: { id: input.cloneFromVersionId },
          include: { ingredients: true, steps: true, allergens: true },
        })
      : null;

    if (input.cloneFromVersionId && !source) throw notFound("Recipe version", input.cloneFromVersionId);

    const version = await tx.recipeVersion.create({
      data: {
        recipeId,
        versionNumber: nextVersionNumber,
        status: "DRAFT",
        createdById: context.actor.id,
        calories: input.calories ?? source?.calories,
        proteinGrams: input.proteinGrams ?? source?.proteinGrams,
        carbsGrams: input.carbsGrams ?? source?.carbsGrams,
        fatGrams: input.fatGrams ?? source?.fatGrams,
        proteinSource: input.proteinSource ?? source?.proteinSource,
        platingNotes: input.platingNotes ?? source?.platingNotes,
      },
    });

    if (source && !input.ingredients.length && !input.steps.length) {
      // Pure clone — copy the source content verbatim.
      await tx.recipeIngredient.createMany({
        data: source.ingredients.map((item) => ({
          recipeVersionId: version.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          unit: item.unit,
          preparationNote: item.preparationNote,
        })),
      });
      await tx.recipeStep.createMany({
        data: source.steps.map((step) => ({
          recipeVersionId: version.id,
          stepNumber: step.stepNumber,
          title: step.title,
          instructions: step.instructions,
          temperatureC: step.temperatureC,
          durationMinutes: step.durationMinutes,
          criticality: step.criticality,
        })),
      });
      await tx.recipeAllergen.createMany({
        data: source.allergens.map((allergen) => ({
          recipeVersionId: version.id,
          allergenCode: allergen.allergenCode,
        })),
      });
    } else {
      await writeVersionContent(tx, version.id, input);
    }

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recipe_version.created",
      entityType: "RecipeVersion",
      entityId: version.id,
      after: { recipeId, versionNumber: nextVersionNumber, clonedFrom: input.cloneFromVersionId ?? null },
      requestId: context.requestId,
    });

    return loadVersion(tx, version.id);
  });
}

export async function updateRecipeVersion(
  id: string,
  input: UpdateRecipeVersionInput,
  context: Context,
) {
  assertCan(context.actor, "recipes:write");

  const version = await db.recipeVersion.findUnique({
    where: { id },
    select: { id: true, status: true, versionNumber: true, recipeId: true },
  });
  if (!version) throw notFound("Recipe version", id);

  // BR-15 — published versions are immutable.
  if (version.status !== "DRAFT") {
    throw unprocessable(
      `Version ${version.versionNumber} is ${version.status.toLowerCase()} and cannot be edited. Create a new version instead.`,
      { status: version.status, recipeId: version.recipeId },
    );
  }

  return db.$transaction(async (tx) => {
    await tx.recipeVersion.update({
      where: { id },
      data: {
        calories: input.calories,
        proteinGrams: input.proteinGrams,
        carbsGrams: input.carbsGrams,
        fatGrams: input.fatGrams,
        proteinSource: input.proteinSource,
        platingNotes: input.platingNotes,
      },
    });

    // Content collections are replaced wholesale when supplied.
    if (input.ingredients || input.steps || input.allergens || input.advance) {
      await tx.recipeIngredient.deleteMany({ where: { recipeVersionId: id } });
      await tx.recipeStep.deleteMany({ where: { recipeVersionId: id } });
      await tx.recipeAllergen.deleteMany({ where: { recipeVersionId: id } });
      await writeVersionContent(tx, id, {
        ingredients: input.ingredients ?? [],
        steps: input.steps ?? [],
        allergens: input.allergens ?? [],
        advance: input.advance ?? [],
      });
    }

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recipe_version.updated",
      entityType: "RecipeVersion",
      entityId: id,
      after: { versionNumber: version.versionNumber },
      requestId: context.requestId,
    });

    return loadVersion(tx, id);
  });
}

export async function publishRecipeVersion(id: string, context: Context) {
  assertCan(context.actor, "recipes:write");

  const version = await db.recipeVersion.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      recipeId: true,
      versionNumber: true,
      _count: { select: { ingredients: true, steps: true } },
    },
  });
  if (!version) throw notFound("Recipe version", id);

  if (version.status === "PUBLISHED") return loadVersion(db, id);
  if (version.status === "ARCHIVED") {
    throw unprocessable("An archived version cannot be published.", { status: version.status });
  }
  if (version._count.steps === 0) {
    throw unprocessable("A recipe needs at least one method step before it can be published.");
  }

  return db.$transaction(async (tx) => {
    await tx.recipeVersion.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "recipe_version.published",
      entityType: "RecipeVersion",
      entityId: id,
      before: { status: version.status },
      after: { status: "PUBLISHED" },
      requestId: context.requestId,
    });

    return loadVersion(tx, id);
  });
}

// ── Content writing ──────────────────────────────────────────────────────────

type VersionContent = {
  ingredients: RecipeIngredientInput[];
  steps: RecipeStepInput[];
  allergens: string[];
  advance: string[];
};

/**
 * Writes ingredients, steps, allergens, and advance-prep for a version.
 *
 * Ingredient lines are deduplicated on (ingredientId, unit) before insert —
 * the table has a unique constraint there, and hitting it used to surface as a
 * 500 rather than a merged line.
 */
async function writeVersionContent(tx: DbClient, versionId: string, content: VersionContent) {
  const resolved = new Map<string, { ingredientId: string; quantity: number; unit: string; note?: string }>();

  for (const item of content.ingredients) {
    const ingredientId = item.ingredientId ?? (await resolveIngredientByName(tx, item.ingredientName!, item.unit));
    const key = `${ingredientId}:${item.unit.toLowerCase()}`;
    const existing = resolved.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.note ??= item.preparationNote;
    } else {
      resolved.set(key, {
        ingredientId,
        quantity: item.quantity,
        unit: item.unit,
        note: item.preparationNote,
      });
    }
  }

  if (resolved.size) {
    await tx.recipeIngredient.createMany({
      data: [...resolved.values()].map((item) => ({
        recipeVersionId: versionId,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unit: item.unit,
        preparationNote: item.note,
      })),
    });
  }

  const steps: Prisma.RecipeStepCreateManyInput[] = content.steps.map((step, index) => ({
    recipeVersionId: versionId,
    // Renumber densely so a caller-supplied gap cannot violate the unique key.
    stepNumber: index + 1,
    title: step.title,
    instructions: step.instructions,
    temperatureC: step.temperatureC,
    durationMinutes: step.durationMinutes,
    criticality: step.criticality,
  }));

  // Advance-prep requirements become mandatory steps, which is what makes them
  // eligible for prep-task generation (BR-3).
  const advanceSteps: Prisma.RecipeStepCreateManyInput[] = content.advance.map((instructions, index) => ({
    recipeVersionId: versionId,
    stepNumber: steps.length + index + 1,
    title: "Advance preparation",
    instructions,
    criticality: "mandatory",
  }));

  if (steps.length || advanceSteps.length) {
    await tx.recipeStep.createMany({ data: [...steps, ...advanceSteps] });
  }

  const allergens = [...new Set(content.allergens.map((code) => code.trim()).filter(Boolean))];
  if (allergens.length) {
    await tx.recipeAllergen.createMany({
      data: allergens.map((allergenCode) => ({ recipeVersionId: versionId, allergenCode })),
    });
  }
}

/** Finds or creates the master ingredient a recipe line refers to by name. */
async function resolveIngredientByName(tx: DbClient, name: string, unit: string): Promise<string> {
  const normalizedName = normaliseIngredientName(name);
  const ingredient = await tx.ingredient.upsert({
    where: { normalizedName },
    update: { active: true },
    create: {
      name,
      normalizedName,
      category: "recipe",
      defaultUnit: unit,
      defaultFrequency: "weekly",
      // Created as a side effect of authoring, so it stays off the inventory
      // master until somebody deliberately manages it.
      inventoryManaged: false,
    },
    select: { id: true },
  });
  return ingredient.id;
}

// ── Loading ──────────────────────────────────────────────────────────────────

const recipeInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    include: {
      ingredients: { include: { ingredient: { select: { id: true, name: true, defaultUnit: true } } } },
      steps: { orderBy: { stepNumber: "asc" } },
      allergens: true,
    },
  },
} satisfies Prisma.RecipeInclude;

async function loadRecipe(client: DbClient, id: string) {
  const recipe = await client.recipe.findUnique({ where: { id }, include: recipeInclude });
  if (!recipe) throw notFound("Recipe", id);
  return recipe;
}

async function loadVersion(client: DbClient, id: string) {
  const version = await client.recipeVersion.findUnique({
    where: { id },
    include: {
      recipe: true,
      ingredients: { include: { ingredient: { select: { id: true, name: true, defaultUnit: true } } } },
      steps: { orderBy: { stepNumber: "asc" } },
      allergens: true,
    },
  });
  if (!version) throw notFound("Recipe version", id);
  return version;
}
