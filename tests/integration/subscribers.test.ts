import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { createSubscriber, listSubscribers, syncFromOnboarding, updateSubscriber } from "@/modules/subscribers";
import * as syncRoute from "@/app/api/v1/integrations/onboarding/subscribers/[submissionId]/route";
import { onboardingSyncSchema } from "@/shared/schemas/subscribers";
import type { Actor } from "@/server/actor";

/** BR-23..BR-25 against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });
const SUBMISSION = "6f1c2b9e-4d3a-4e8f-9a1b-2c3d4e5f6a7b";
const TOKEN = "t".repeat(40);

const payload = (overrides: Record<string, unknown> = {}) => ({
  ref: "KSH-AB12C",
  name: "Asha Rao",
  phone: "+919845000000",
  email: "asha@example.com",
  address: "12 Palace Road",
  diet: "Vegetarian",
  allergies: ["Peanuts"],
  deliveryPlan: "Single Slot",
  weight: "62.50",
  ...overrides,
});

const put = (body: unknown, token: string | null = TOKEN, id = SUBMISSION) =>
  syncRoute.PUT(
    new Request(`http://localhost/api/v1/integrations/onboarding/subscribers/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ submissionId: id }) },
  );

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
  process.env.ONBOARDING_SYNC_TOKEN = TOKEN;
});

afterEach(() => {
  delete process.env.ONBOARDING_SYNC_TOKEN;
});

describe("BR-23 onboarding sync endpoint", () => {
  it("creates an onboarding subscriber on first sync, attributed to the integration user", async () => {
    const response = await put(payload());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.created).toBe(true);
    expect(body.data.subscriber).toMatchObject({
      status: "onboarding",
      source: "onboarding",
      onboardingRef: "KSH-AB12C",
      deliverySlot: "Single Slot",
      allergies: ["Peanuts"],
      profile: { weightKg: 62.5 },
    });

    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "subscriber.created" }, include: { actor: true } });
    expect(audit.actor).toMatchObject({ email: "onboarding-sync@kosh.local", role: "INTEGRATION" });
  });

  it("updates on resync without touching what operations decided", async () => {
    await put(payload());
    const subscriber = await db.subscriber.findUniqueOrThrow({ where: { externalRef: SUBMISSION } });
    const plan = await db.subscriptionPlan.create({ data: { name: "Full Board", dailyRate: 2400 } });
    await updateSubscriber(subscriber.id, { status: "active", planId: plan.id, notes: "VIP", startDate: "2026-11-15" }, context());

    const response = await put(payload({ phone: "+919845111111", allergies: ["Peanuts", "Shellfish"] }));
    expect(response.status).toBe(200);

    const after = await db.subscriber.findUniqueOrThrow({ where: { externalRef: SUBMISSION } });
    expect(after).toMatchObject({ phone: "+919845111111", allergies: ["Peanuts", "Shellfish"], status: "active", planId: plan.id, notes: "VIP" });
    expect(await db.subscriber.count()).toBe(1);
  });

  it("survives concurrent syncs of the same submission", async () => {
    const results = await Promise.all([put(payload()), put(payload()), put(payload())]);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(await db.subscriber.count()).toBe(1);
  });

  it("rejects a missing or wrong token", async () => {
    expect((await put(payload(), null)).status).toBe(401);
    expect((await put(payload(), "x".repeat(40))).status).toBe(401);
    expect((await put(payload(), TOKEN.slice(1))).status).toBe(401);
    expect(await db.subscriber.count()).toBe(0);
  });

  it("refuses to run when no token is configured", async () => {
    delete process.env.ONBOARDING_SYNC_TOKEN;
    const response = await put(payload());
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toMatch(/not configured/);
  });

  it("validates the payload", async () => {
    const response = await put({ ref: "KSH-1" });
    expect(response.status).toBe(400);
  });
});

describe("capabilities", () => {
  it("the integration role can sync but cannot edit subscribers", async () => {
    const integration = await db.user.create({ data: { name: "Bot", email: "bot@kosh.local", role: "INTEGRATION" } });
    const ctx = { actor: integration, requestId: "r" };
    await syncFromOnboarding(SUBMISSION, onboardingSyncSchema.parse(payload()), ctx);
    const row = await db.subscriber.findFirstOrThrow();
    await expect(updateSubscriber(row.id, { status: "ended" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("kitchen staff cannot create subscribers", async () => {
    const kitchen = await seedActor("KITCHEN");
    await expect(createSubscriber({ name: "X", status: "active", planId: null, allergies: [], startDate: null } as never, { actor: kitchen, requestId: "r" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("BR-25 roster", () => {
  it("summarises the whole roster even when filtered", async () => {
    await createSubscriber({ name: "A", status: "active", planId: null, allergies: [], startDate: null } as never, context());
    await createSubscriber({ name: "B", status: "paused", planId: null, allergies: [], startDate: null } as never, context());
    await createSubscriber({ name: "C", status: "ended", planId: null, allergies: [], startDate: null } as never, context());

    const { subscribers, summary } = await listSubscribers({ status: "active" });
    expect(subscribers.map((s) => s.name)).toEqual(["A"]);
    expect(summary).toMatchObject({ total: 3, active: 1, paused: 1, ended: 1, seatsTaken: 2, capacity: 40 });
  });

  it("enforces known statuses in the database itself", async () => {
    await expect(db.subscriber.create({ data: { name: "Z", status: "vip" } })).rejects.toThrow(/subscribers_status_known/);
  });
});
