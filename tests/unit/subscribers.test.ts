import { describe, expect, it } from "vitest";
import { fromOnboarding, rosterSummary, whatsappNumber } from "@/modules/subscribers/domain/subscriber";
import { createSubscriberSchema, onboardingSyncSchema, updateSubscriberSchema } from "@/shared/schemas/subscribers";

// BR-23..BR-25

describe("BR-25 roster summary", () => {
  it("counts seats for everyone the kitchen has committed to", () => {
    const summary = rosterSummary(["active", "active", "onboarding", "paused", "ended"], 4);
    expect(summary).toMatchObject({ active: 2, onboarding: 1, paused: 1, ended: 1, seatsTaken: 4, seatsLeft: 0, overCapacity: false });
  });

  it("flags over capacity and never reports negative seats", () => {
    const summary = rosterSummary(["active", "active", "active"], 2);
    expect(summary).toMatchObject({ seatsLeft: 0, overCapacity: true });
  });
});

describe("BR-23 onboarding mapping", () => {
  const payload = onboardingSyncSchema.parse({
    ref: "KSH-H8K3A",
    name: "Asha Rao",
    phone: "+919845000000",
    email: "asha@example.com",
    address: "12 Palace Road, Sadashivanagar",
    deliveryPlan: "Single Slot",
    diet: "Vegetarian",
    allergies: ["Peanuts", " Peanuts ", ""],
    weight: "62.50",
    height: "165.00",
    goal: "Fat loss",
    cuisines: [],
    notes: "",
  });
  const now = new Date("2026-11-12T10:00:00Z");
  const { synced, createOnly } = fromOnboarding("0b8f5a3e-0000-4000-8000-000000000001", payload, now);

  it("coerces numeric strings and drops empty answers from the profile", () => {
    expect(synced.profile).toEqual({ weightKg: 62.5, heightCm: 165, goal: "Fat loss" });
  });

  it("dedupes and trims allergies", () => {
    expect(synced.allergies).toEqual(["Peanuts"]);
  });

  it("maps the delivery plan to the delivery slot, not a pricing plan", () => {
    expect(synced.deliverySlot).toBe("Single Slot");
    expect(synced).not.toHaveProperty("planId");
  });

  it("never syncs fields operations own", () => {
    for (const key of ["status", "planId", "startDate", "notes"]) expect(synced).not.toHaveProperty(key);
    expect(createOnly).toEqual({ externalRef: "0b8f5a3e-0000-4000-8000-000000000001", source: "onboarding", status: "onboarding" });
  });
});

describe("contracts", () => {
  it("defaults a manual subscriber to active with no plan", () => {
    expect(createSubscriberSchema.parse({ name: "Walk-in" })).toMatchObject({ status: "active", planId: null, allergies: [] });
  });

  it("turns blank text into null so a form can clear a field", () => {
    expect(updateSubscriberSchema.parse({ phone: "  ", email: "" })).toEqual({ phone: null, email: null });
  });

  it("rejects unknown statuses and bad emails", () => {
    expect(updateSubscriberSchema.safeParse({ status: "vip" }).success).toBe(false);
    expect(updateSubscriberSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("WhatsApp numbers", () => {
  it("adds India's code to bare 10-digit numbers", () => {
    expect(whatsappNumber("98450 00000")).toBe("919845000000");
    expect(whatsappNumber("+91 98450-00000")).toBe("919845000000");
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
});
