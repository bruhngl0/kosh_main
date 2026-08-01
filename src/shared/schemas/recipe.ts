import { z } from "zod";
import {
  criticalitySchema,
  idSchema,
  mealTypeSchema,
  optionalText,
  positiveQuantitySchema,
  unitSchema,
} from "@/shared/schemas/common";

export const recipeIngredientSchema = z
  .object({
    ingredientId: idSchema.optional(),
    ingredientName: z.string().trim().min(1).max(160).optional(),
    quantity: positiveQuantitySchema,
    unit: unitSchema,
    preparationNote: optionalText(500),
  })
  .refine((value) => Boolean(value.ingredientId ?? value.ingredientName), {
    message: "Select or enter an ingredient.",
    path: ["ingredientName"],
  });

export const recipeStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().trim().min(1, "A step title is required.").max(120),
  instructions: z.string().trim().min(1, "Instructions are required.").max(4000),
  temperatureC: z.number().min(-40).max(400).optional(),
  durationMinutes: z.number().int().positive().max(10_080).optional(),
  criticality: criticalitySchema.default("info"),
});

/** Nutrition and method, shared by create and version-edit. */
const versionBodySchema = z.object({
  calories: z.number().nonnegative().max(100_000).optional(),
  proteinGrams: z.number().nonnegative().max(10_000).optional(),
  carbsGrams: z.number().nonnegative().max(10_000).optional(),
  fatGrams: z.number().nonnegative().max(10_000).optional(),
  proteinSource: optionalText(80),
  platingNotes: optionalText(2000),
  allergens: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  ingredients: z.array(recipeIngredientSchema).max(100).default([]),
  steps: z.array(recipeStepSchema).max(60).default([]),
  /** Free-text advance-prep requirements; become mandatory steps (BR-3). */
  advance: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
});

export const createRecipeSchema = versionBodySchema.extend({
  title: z.string().trim().min(1, "A recipe title is required.").max(160),
  subtitle: optionalText(300),
  mealType: mealTypeSchema,
  /** Publish immediately instead of leaving the first version as a draft.
   *  Without this the recipe is invisible to the planner (BR-15). */
  publish: z.boolean().default(false),
});

/** Stable identity fields only — nutrition and method belong to a version. */
export const updateRecipeSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    subtitle: optionalText(300),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const createRecipeVersionSchema = versionBodySchema.extend({
  /** Copy the latest version's content as a starting point. */
  cloneFromVersionId: idSchema.optional(),
});

/** BR-15 — only draft versions may be edited. */
export const updateRecipeVersionSchema = versionBodySchema.partial();

export const recipeQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  mealType: mealTypeSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type CreateRecipeVersionInput = z.infer<typeof createRecipeVersionSchema>;
export type UpdateRecipeVersionInput = z.infer<typeof updateRecipeVersionSchema>;
export type RecipeIngredientInput = z.infer<typeof recipeIngredientSchema>;
export type RecipeStepInput = z.infer<typeof recipeStepSchema>;
