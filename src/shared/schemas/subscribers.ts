import { z } from "zod";
import { isoDateSchema } from "@/shared/schemas/finance";

/**
 * Subscriber contracts — shared by the /subscribers screen, the route handlers,
 * and the onboarding sync endpoint. See docs/system-design.md BR-23..BR-25.
 */

export const SUBSCRIBER_STATUSES = ["onboarding", "active", "paused", "ended"] as const;
export const subscriberStatusSchema = z.enum(SUBSCRIBER_STATUSES);
export type SubscriberStatus = z.infer<typeof subscriberStatusSchema>;

/** Trimmed, length-capped, and "" → null, so blank form fields clear a value. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .nullish()
    .transform((value) => (value ? value : null));

const allergiesSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .default([])
  .transform((items) => [...new Set(items.map((item) => item.trim()))]);

const subscriberFields = {
  name: z.string().trim().min(2, "Name is required.").max(150),
  status: subscriberStatusSchema,
  planId: z.string().uuid("Pick a plan from the list.").nullable(),
  phone: optionalText(20),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Not a valid email address.")
    .or(z.literal(""))
    .nullish()
    .transform((value) => (value ? value : null)),
  address: optionalText(1000),
  landmark: optionalText(200),
  deliveryNote: optionalText(500),
  deliverySlot: optionalText(60),
  diet: optionalText(60),
  allergies: allergiesSchema,
  dislikes: optionalText(1000),
  medical: optionalText(1000),
  startDate: isoDateSchema.nullable(),
  notes: optionalText(2000),
};

export const createSubscriberSchema = z.object({
  ...subscriberFields,
  status: subscriberStatusSchema.default("active"),
  planId: subscriberFields.planId.optional().default(null),
  startDate: subscriberFields.startDate.optional().default(null),
});

export const updateSubscriberSchema = z
  .object(subscriberFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const subscriberQuerySchema = z.object({
  status: subscriberStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

/**
 * BR-23: what the onboarding app sends for a confirmed submission. Numbers may
 * arrive as strings (Postgres NUMERIC through drizzle), so they are coerced.
 */
const looseNumber = z.coerce.number().finite().nullish();

export const onboardingSyncSchema = z.object({
  ref: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(150),
  phone: optionalText(20),
  email: optionalText(255),
  address: optionalText(1000),
  landmark: optionalText(200),
  deliveryNote: optionalText(500),
  deliveryPlan: optionalText(60),
  diet: optionalText(60),
  allergies: z.array(z.string()).nullish().transform((items) => (items ?? []).map((i) => i.trim()).filter(Boolean)),
  dislikes: optionalText(1000),
  medical: optionalText(1000),
  notes: optionalText(2000),
  // Profile — kept as-is for the kitchen to read.
  dob: z.string().max(10).nullish(),
  gender: optionalText(40),
  weight: looseNumber,
  height: looseNumber,
  targetWeight: looseNumber,
  bmi: looseNumber,
  goal: optionalText(100),
  activity: optionalText(100),
  spice: optionalText(60),
  cuisines: z.array(z.string()).nullish(),
  favDish: optionalText(200),
  submittedAt: z.string().max(40).nullish(),
});

export type CreateSubscriberInput = z.output<typeof createSubscriberSchema>;
export type UpdateSubscriberInput = z.output<typeof updateSubscriberSchema>;
export type OnboardingSyncInput = z.output<typeof onboardingSyncSchema>;
