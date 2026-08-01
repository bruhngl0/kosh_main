import { z } from "zod";
import { idSchema, moneySchema, optionalText, quantitySchema, unitSchema } from "@/shared/schemas/common";

export const purchaseOrderStatusSchema = z.enum([
  "DRAFT",
  "OUTREACH_READY",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
]);

export const createVendorSchema = z.object({
  name: z.string().trim().min(1, "A vendor name is required.").max(160),
  category: optionalText(80),
  contact: optionalText(120),
  whatsapp: optionalText(40),
  phone: optionalText(40),
  // Empty form fields arrive as "" and must not fail email validation.
  email: z
    .union([z.string().trim().email("Must be a valid email address."), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  minimumOrder: optionalText(120),
  leadTime: optionalText(120),
  cutoff: optionalText(120),
  area: optionalText(120),
  paymentTerms: optionalText(120),
  notes: optionalText(1000),
});

export const updateVendorSchema = createVendorSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

/** Sets an ingredient's price and preferred flag for one vendor. */
export const linkVendorIngredientSchema = z.object({
  unitCost: moneySchema.optional(),
  unit: unitSchema.optional(),
  minimumQty: quantitySchema.optional(),
  preferred: z.boolean().default(false),
});

export const generatePurchaseOrderSchema = z.object({
  cycleId: idSchema,
  weekNumber: z.number().int().min(1).max(53),
});

export const createPurchaseOrderSchema = z.object({
  vendorId: idSchema,
  cycleId: idSchema.optional(),
  weekNumber: z.number().int().min(1).max(53).optional(),
  notes: optionalText(1000),
  lines: z
    .array(
      z.object({
        ingredientId: idSchema,
        requestedQty: quantitySchema.refine((value) => value > 0, "Quantity must be greater than zero."),
        unit: unitSchema,
        unitCost: moneySchema.optional(),
        notes: optionalText(500),
      }),
    )
    .min(1, "A purchase order needs at least one line."),
});

/** BR-12 — the transition is validated against the state machine server-side. */
export const transitionPurchaseOrderSchema = z.object({
  status: purchaseOrderStatusSchema,
  notes: optionalText(1000),
});

/** BR-13 — receiving writes RECEIVE movements for each line. */
export const receivePurchaseOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: idSchema,
        receivedQty: quantitySchema,
        /** Overrides the line's unit cost when the invoice differs. */
        unitCost: moneySchema.optional(),
      }),
    )
    .min(1, "Record at least one received line."),
  reference: optionalText(200),
});

export const purchaseOrderQuerySchema = z.object({
  cycleId: idSchema.optional(),
  vendorId: idSchema.optional(),
  weekNumber: z.coerce.number().int().min(1).max(53).optional(),
  status: purchaseOrderStatusSchema.optional(),
  openOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const costSummaryQuerySchema = z.object({
  cycleId: idSchema.optional(),
  weekNumber: z.coerce.number().int().min(1).max(53).optional(),
  productionDays: z.coerce.number().int().min(1).max(31).default(5),
  mealsPerDay: z.coerce.number().int().min(1).max(6).default(4),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type LinkVendorIngredientInput = z.infer<typeof linkVendorIngredientSchema>;
export type GeneratePurchaseOrderInput = z.infer<typeof generatePurchaseOrderSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type TransitionPurchaseOrderInput = z.infer<typeof transitionPurchaseOrderSchema>;
