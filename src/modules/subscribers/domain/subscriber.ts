/**
 * Subscriber rules. Pure — no I/O. See docs/system-design.md BR-23..BR-25.
 */

import type { OnboardingSyncInput, SubscriberStatus } from "@/shared/schemas/subscribers";

export const DEFAULT_CAPACITY = 40;

/**
 * BR-25: a seat is held by anyone the kitchen has committed to — receiving
 * meals, onboarding toward their first delivery, or paused with a place kept.
 * Only "ended" frees a seat.
 */
export const HOLDS_SEAT: ReadonlySet<SubscriberStatus> = new Set(["onboarding", "active", "paused"]);

export function rosterSummary(statuses: readonly string[], capacity = DEFAULT_CAPACITY) {
  const count = (status: SubscriberStatus) => statuses.filter((s) => s === status).length;
  const seatsTaken = statuses.filter((s) => HOLDS_SEAT.has(s as SubscriberStatus)).length;
  return {
    total: statuses.length,
    onboarding: count("onboarding"),
    active: count("active"),
    paused: count("paused"),
    ended: count("ended"),
    capacity,
    seatsTaken,
    seatsLeft: Math.max(0, capacity - seatsTaken),
    overCapacity: seatsTaken > capacity,
  };
}

export type RosterSummary = ReturnType<typeof rosterSummary>;

/**
 * BR-23: maps a confirmed onboarding submission onto subscriber fields.
 *
 * `synced` fields are rewritten on every sync, so a client's corrected phone
 * number or new allergy flows through. `createOnly` fields are set once: after
 * that, status, plan, start date and notes belong to operations and a resync
 * must never overwrite them.
 */
export function fromOnboarding(submissionId: string, input: OnboardingSyncInput, now: Date) {
  const profile = Object.fromEntries(
    Object.entries({
      dob: input.dob,
      gender: input.gender,
      weightKg: input.weight,
      heightCm: input.height,
      targetWeightKg: input.targetWeight,
      bmi: input.bmi,
      goal: input.goal,
      activity: input.activity,
      spice: input.spice,
      cuisines: input.cuisines?.length ? input.cuisines : null,
      favouriteDish: input.favDish,
      clientNotes: input.notes,
      submittedAt: input.submittedAt,
    }).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );

  const synced = {
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    landmark: input.landmark,
    deliveryNote: input.deliveryNote,
    deliverySlot: input.deliveryPlan,
    diet: input.diet,
    allergies: [...new Set(input.allergies)],
    dislikes: input.dislikes,
    medical: input.medical,
    profile,
    onboardingRef: input.ref,
    syncedAt: now,
  };

  const createOnly = {
    externalRef: submissionId,
    source: "onboarding",
    status: "onboarding" as SubscriberStatus,
  };

  return { synced, createOnly };
}

/** Digits only, for a wa.me link. Indian numbers without a country code get +91. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 8 ? digits : null;
}
