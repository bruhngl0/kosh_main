import type { MealType } from "@prisma/client";
import { db } from "@/server/db";
import { normaliseIngredientName } from "@/shared/schemas/common";

/** Fixture builders for integration tests. Everything gets a sensible default. */

export async function makeVendor(overrides: { name?: string; whatsapp?: string } = {}) {
  return db.vendor.create({
    data: {
      name: overrides.name ?? `Vendor ${crypto.randomUUID().slice(0, 8)}`,
      whatsapp: overrides.whatsapp ?? "+91 98440 11111",
      contact: "Salim",
    },
  });
}

export async function makeIngredient(overrides: {
  name?: string;
  defaultUnit?: string;
  quantity?: number;
  parLevel?: number;
  vendorId?: string;
  unitCost?: number;
  purchaseUnit?: string;
  preferred?: boolean;
} = {}) {
  const name = overrides.name ?? `Ingredient ${crypto.randomUUID().slice(0, 8)}`;

  const ingredient = await db.ingredient.create({
    data: {
      name,
      normalizedName: normaliseIngredientName(name),
      category: "produce",
      defaultUnit: overrides.defaultUnit ?? "kg",
      defaultFrequency: "weekly",
      inventoryManaged: true,
      balance: {
        create: {
          quantity: overrides.quantity ?? 0,
          parLevel: overrides.parLevel ?? 0,
          reorderPoint: overrides.parLevel ?? 0,
        },
      },
    },
    include: { balance: true },
  });

  if (overrides.vendorId) {
    await db.vendorIngredient.create({
      data: {
        vendorId: overrides.vendorId,
        ingredientId: ingredient.id,
        unitCost: overrides.unitCost ?? 100,
        unit: overrides.purchaseUnit ?? overrides.defaultUnit ?? "kg",
        preferred: overrides.preferred ?? true,
      },
    });
  }

  return ingredient;
}

export async function makeRecipe(overrides: {
  title?: string;
  mealType?: MealType;
  proteinSource?: string;
  status?: "DRAFT" | "PUBLISHED";
  ingredients?: { ingredientId: string; quantity: number; unit: string }[];
  steps?: { stepNumber: number; title: string; instructions: string; criticality: string }[];
} = {}) {
  const title = overrides.title ?? `Recipe ${crypto.randomUUID().slice(0, 8)}`;

  const recipe = await db.recipe.create({
    data: {
      title,
      mealType: overrides.mealType ?? "LU",
      versions: {
        create: {
          versionNumber: 1,
          status: overrides.status ?? "PUBLISHED",
          proteinSource: overrides.proteinSource ?? "chicken",
          calories: 500,
          proteinGrams: 40,
          ingredients: overrides.ingredients ? { create: overrides.ingredients } : undefined,
          steps: {
            create: overrides.steps ?? [
              { stepNumber: 1, title: "Cook", instructions: "Cook it.", criticality: "info" },
            ],
          },
        },
      },
    },
    include: { versions: true },
  });

  return { recipe, version: recipe.versions[0] };
}

export async function makeCycle(overrides: {
  cycleNumber?: number;
  durationDays?: number;
  subscriberCount?: number;
  weekStart?: Date | null;
  status?: "DRAFT" | "ACTIVE";
} = {}) {
  const durationDays = overrides.durationDays ?? 7;

  return db.cycle.create({
    data: {
      name: `Cycle ${overrides.cycleNumber ?? 1}`,
      cycleNumber: overrides.cycleNumber ?? 1,
      durationDays,
      subscriberCount: overrides.subscriberCount ?? 10,
      status: overrides.status ?? "DRAFT",
      weekStart: overrides.weekStart === undefined ? new Date("2026-08-03T00:00:00.000Z") : overrides.weekStart,
      days: {
        create: Array.from({ length: durationDays }, (_, index) => ({
          dayNumber: index + 1,
          weekNumber: Math.floor(index / 7) + 1,
          phaseLabel: "Establish",
        })),
      },
    },
    include: { days: { orderBy: { dayNumber: "asc" } } },
  });
}

/** Fills every slot of a cycle so it satisfies BR-4. */
export async function fillCycle(cycleId: string, versionsByMeal: Partial<Record<MealType, string>>) {
  const days = await db.cycleDay.findMany({ where: { cycleId }, orderBy: { dayNumber: "asc" } });
  const cycle = await db.cycle.findUniqueOrThrow({ where: { id: cycleId }, select: { subscriberCount: true } });

  for (const day of days) {
    for (const [mealType, recipeVersionId] of Object.entries(versionsByMeal)) {
      if (!recipeVersionId) continue;
      await db.mealAssignment.create({
        data: {
          cycleDayId: day.id,
          mealType: mealType as MealType,
          recipeVersionId,
          servings: cycle.subscriberCount,
        },
      });
    }
  }
}

export const balanceOf = async (ingredientId: string) => {
  const balance = await db.inventoryBalance.findUnique({ where: { ingredientId } });
  return Number(balance?.quantity ?? 0);
};
