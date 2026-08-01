import { z } from "zod";
import {
  idSchema,
  mealTypeSchema,
  optionalText,
  prepTaskStatusSchema,
} from "@/shared/schemas/common";

export { mealTypeSchema, cycleStatusSchema } from "@/shared/schemas/common";

export const createCycleSchema = z.object({
  name: z.string().trim().min(1, "A cycle name is required.").max(120),
  cycleNumber: z.number().int().positive("Cycle number must be positive."),
  durationDays: z.number().int().min(1).max(366).default(28),
  weekStart: z.coerce.date().optional(),
  subscriberCount: z.number().int().positive("There must be at least one subscriber.").default(1),
  foodCostTargetPercent: z.number().min(0).max(100).optional(),
  chefName: optionalText(120),
  /** BR-1 — rolling window within which a dinner protein may not repeat. */
  proteinWindowDays: z.number().int().min(1).max(28).default(4),
});

/** Metadata edit. Structural fields (duration, cycle number) are not editable
 *  after creation because cycle days are already materialised against them. */
export const updateCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    weekStart: z.coerce.date().nullish(),
    subscriberCount: z.number().int().positive().optional(),
    foodCostTargetPercent: z.number().min(0).max(100).nullish(),
    chefName: optionalText(120),
    proteinWindowDays: z.number().int().min(1).max(28).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const assignMealSchema = z.object({
  recipeVersionId: idSchema,
  /** Defaults to the cycle's subscriber count when omitted. */
  servings: z.number().int().positive().optional(),
  notes: optionalText(1000),
});

/** Path params for the meal-slot endpoints, coerced from strings. */
export const mealSlotParamsSchema = z.object({
  id: idSchema,
  day: z.coerce.number().int().positive("Day must be a positive number."),
  meal: mealTypeSchema,
});

export const cycleQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
});

export const conflictQuerySchema = z.object({
  /** Overrides the cycle's configured window for a what-if check. */
  windowDays: z.coerce.number().int().min(1).max(28).optional(),
});

export const productionQuerySchema = z.object({
  week: z.coerce.number().int().min(1).max(53),
});

export const prepTaskUpdateSchema = z.object({
  status: prepTaskStatusSchema,
});

export const prepTaskQuerySchema = z.object({
  status: prepTaskStatusSchema.optional(),
  week: z.coerce.number().int().min(1).max(53).optional(),
  urgentOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

/** BR-14 — record what a production run actually consumed. */
export const consumeProductionSchema = z.object({
  meals: z.array(mealTypeSchema).min(1, "Select at least one meal.").optional(),
  reference: optionalText(200),
  /** Requires an authorised actor; recorded on each movement (BR-10). */
  allowNegative: z.boolean().default(false),
});

export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export type UpdateCycleInput = z.infer<typeof updateCycleSchema>;
export type AssignMealInput = z.infer<typeof assignMealSchema>;
export type ConsumeProductionInput = z.infer<typeof consumeProductionSchema>;
