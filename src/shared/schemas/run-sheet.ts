import { z } from "zod";
import { isoDateSchema } from "@/shared/schemas/finance";

/** Daily run sheet contracts. See docs/system-design.md BR-26..BR-29. */

/** The checklist's phases, in the order the day runs. */
export const PHASE_IDS = ["prep", "cook", "pack", "dispatch", "close", "evening"] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

export const TASK_OWNERS = ["Chef", "Assist", "Rider"] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];

export const VESSEL_STATES = ["out", "collected", "missing"] as const;
export const vesselStateSchema = z.enum(VESSEL_STATES);
export type VesselState = z.infer<typeof vesselStateSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const runSheetDateParams = z.object({ date: isoDateSchema });

/** Only the fields sent are changed; send null or "" to clear one. */
export const updateRunSheetSchema = z
  .object({
    chefName: optionalText(100),
    dispatchWindow: optionalText(100),
    specialNotes: optionalText(500),
    notes: optionalText(5000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field to change.");
export type UpdateRunSheetInput = z.infer<typeof updateRunSheetSchema>;

export const setCheckSchema = z.union([
  z.object({ taskKey: z.string().trim().min(1).max(64), done: z.boolean() }),
  z.object({ all: z.literal(true) }),
]);
export type SetCheckInput = z.infer<typeof setCheckSchema>;

export const addRunSheetTaskSchema = z.object({
  phase: z.enum(PHASE_IDS),
  title: z.string().trim().min(2, "Describe the task.").max(200),
  owner: z.enum(TASK_OWNERS).default("Chef"),
});
export type AddRunSheetTaskInput = z.infer<typeof addRunSheetTaskSchema>;

/** null clears the vessel back to "not dispatched". */
export const setVesselSchema = z.object({ status: vesselStateSchema.nullable() });
