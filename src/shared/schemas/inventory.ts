import { z } from "zod";
import {
  idSchema,
  ingredientStatusSchema,
  moneySchema,
  optionalText,
  orderFrequencySchema,
  positiveQuantitySchema,
  quantitySchema,
  unitSchema,
} from "@/shared/schemas/common";

export { ingredientStatusSchema, orderFrequencySchema } from "@/shared/schemas/common";

export const createIngredientSchema = z.object({
  name: z.string().trim().min(1, "An ingredient name is required.").max(160),
  category: z.string().trim().min(1, "A category is required.").max(80),
  /** The stock unit. Balances are always expressed in it (§6.2). */
  defaultUnit: unitSchema,
  defaultFrequency: orderFrequencySchema,
  notes: optionalText(1000),
  parLevel: quantitySchema.default(0),
  quantity: quantitySchema.default(0),
  quantityNeeded: quantitySchema.default(0),
  reorderPoint: quantitySchema.optional(),
  unitCost: moneySchema.optional(),
  vendorId: idSchema.optional(),
  /** Purchase unit, when the vendor sells in something other than the stock unit. */
  purchaseUnit: unitSchema.optional(),
  status: ingredientStatusSchema.default("needed"),
});

export const updateIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    defaultUnit: unitSchema.optional(),
    defaultFrequency: orderFrequencySchema.optional(),
    notes: optionalText(1000),
    parLevel: quantitySchema.optional(),
    reorderPoint: quantitySchema.optional(),
    quantityNeeded: quantitySchema.optional(),
    status: ingredientStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const ingredientQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  category: z.string().trim().max(80).optional(),
  frequency: orderFrequencySchema.optional(),
  status: ingredientStatusSchema.optional(),
  /** Restricts to rows on the inventory master, excluding recipe-derived ones. */
  managedOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  belowParOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

/**
 * BR-9 — the caller supplies a magnitude and a type. The sign is derived by the
 * domain layer; a signed delta is never accepted from a client.
 */
export const inventoryMovementSchema = z
  .object({
    ingredientId: idSchema,
    type: z.enum(["RECEIVE", "CONSUME", "ADJUST", "WASTE", "RETURN"]),
    /** For ADJUST this is the counted balance, not a delta. */
    quantity: quantitySchema,
    /** Unit of `quantity`; converted to the ingredient's stock unit. */
    unit: unitSchema.optional(),
    unitCost: moneySchema.optional(),
    reason: optionalText(500),
    reference: optionalText(200),
    /** BR-10 — permits the balance to go negative. Requires authorisation. */
    allowNegative: z.boolean().default(false),
  })
  .refine((value) => !["WASTE", "ADJUST"].includes(value.type) || Boolean(value.reason), {
    message: "A reason is required for waste and adjustment movements.",
    path: ["reason"],
  })
  .refine((value) => value.type === "ADJUST" || value.quantity > 0, {
    message: "Quantity must be greater than zero.",
    path: ["quantity"],
  });

export const movementQuerySchema = z.object({
  ingredientId: idSchema.optional(),
  type: z.enum(["RECEIVE", "CONSUME", "ADJUST", "WASTE", "RETURN"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const createVesselKitSchema = z.object({
  subscriberId: idSchema.optional(),
  /** Used when registering a kit for a subscriber who is not on file yet. */
  subscriberName: z.string().trim().min(1).max(160).optional(),
  type: z.enum(["steel", "copper"]),
  status: z.enum(["active", "needs-replace", "retired"]).default("active"),
  sets: z.number().int().min(1).max(2).default(2),
  issuedAt: z.coerce.date().optional(),
  sanitisedAt: z.coerce.date().optional(),
  notes: optionalText(1000),
}).refine((value) => Boolean(value.subscriberId ?? value.subscriberName), {
  message: "Select or name a subscriber.",
  path: ["subscriberName"],
});

export const updateVesselKitSchema = z
  .object({
    type: z.enum(["steel", "copper"]).optional(),
    status: z.enum(["active", "needs-replace", "retired"]).optional(),
    sets: z.number().int().min(1).max(2).optional(),
    issuedAt: z.coerce.date().nullish(),
    sanitisedAt: z.coerce.date().nullish(),
    notes: optionalText(1000),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;
export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;
export type CreateVesselKitInput = z.infer<typeof createVesselKitSchema>;
export type UpdateVesselKitInput = z.infer<typeof updateVesselKitSchema>;

export { positiveQuantitySchema };
