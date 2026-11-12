import type { Prisma, Subscriber, SubscriptionPlan } from "@prisma/client";
import { db, type DbClient } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { toDateString, toNumber } from "@/shared/money";
import { DEFAULT_CAPACITY, deliversOn, fromOnboarding, rosterSummary, whatsappNumber } from "@/modules/subscribers/domain/subscriber";
import type {
  CreateSubscriberInput,
  OnboardingSyncInput,
  SubscriberStatus,
  UpdateSubscriberInput,
} from "@/shared/schemas/subscribers";

type Context = { actor: Actor; requestId: string };
type Row = Subscriber & { plan: SubscriptionPlan | null; _count?: { kits: number } };

/** Kitchen capacity in seats. Configurable because the "cook for 40" number will move. */
export function subscriberCapacity() {
  const value = Number(process.env.SUBSCRIBER_CAPACITY);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CAPACITY;
}

export function toSubscriberView(row: Row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status as SubscriberStatus,
    plan: row.plan ? { id: row.plan.id, name: row.plan.name, dailyRate: toNumber(row.plan.dailyRate) } : null,
    phone: row.phone,
    whatsapp: whatsappNumber(row.phone),
    email: row.email,
    address: row.address,
    landmark: row.landmark,
    deliveryNote: row.deliveryNote,
    deliverySlot: row.deliverySlot,
    diet: row.diet,
    allergies: row.allergies,
    dislikes: row.dislikes,
    medical: row.medical,
    profile: (row.profile ?? {}) as Record<string, unknown>,
    startDate: toDateString(row.startDate),
    notes: row.notes,
    source: row.source,
    onboardingRef: row.onboardingRef,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    kitCount: row._count?.kits ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SubscriberView = ReturnType<typeof toSubscriberView>;

const include = { plan: true, _count: { select: { kits: true } } } satisfies Prisma.SubscriberInclude;

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listSubscribers(filter: { status?: SubscriberStatus; q?: string } = {}) {
  const q = filter.q?.trim();
  const where: Prisma.SubscriberWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
            { onboardingRef: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, statuses] = await Promise.all([
    db.subscriber.findMany({ where, include }),
    // The summary always describes the whole roster, not the filtered slice.
    db.subscriber.findMany({ select: { status: true } }),
  ]);

  // New arrivals first — they are the ones needing action — then by name.
  const order: Record<string, number> = { onboarding: 0, active: 1, paused: 2, ended: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));

  return {
    subscribers: rows.map(toSubscriberView),
    summary: rosterSummary(statuses.map((s) => s.status), subscriberCapacity()),
  };
}

export async function getSubscriber(id: string) {
  const row = await db.subscriber.findUnique({
    where: { id },
    include: { ...include, kits: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) throw notFound("Subscriber", id);
  return {
    ...toSubscriberView(row),
    kits: row.kits.map((kit) => ({
      id: kit.id,
      type: kit.type,
      status: kit.status,
      sets: kit.sets,
      issuedAt: toDateString(kit.issuedAt),
      sanitisedAt: toDateString(kit.sanitisedAt),
    })),
  };
}

export async function listSubscriptionPlans() {
  const plans = await db.subscriptionPlan.findMany({ where: { active: true }, orderBy: { dailyRate: "desc" } });
  return plans.map((plan) => ({ id: plan.id, name: plan.name, dailyRate: toNumber(plan.dailyRate) }));
}

/** Published for other modules (e.g. cycles, finance) that need head-counts. */
export async function getRosterSummary() {
  const statuses = await db.subscriber.findMany({ select: { status: true } });
  return rosterSummary(statuses.map((s) => s.status), subscriberCapacity());
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function assertPlanExists(planId: string | null | undefined) {
  if (!planId) return;
  const plan = await db.subscriptionPlan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) {
    throw new AppError("VALIDATION_ERROR", "That plan does not exist.", { fields: { planId: ["That plan does not exist."] } });
  }
}

const dateColumn = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);

/**
 * BR-30 — a change to who is delivered to moves the open cycles' servings, in
 * the same transaction, so the roster and the shopping list cannot disagree.
 *
 * Imported lazily: the cycles module reads the roster through this module's
 * barrel, and a static import back would make the two load each other.
 */
async function followRoster(tx: DbClient, context: Context, reason: string) {
  const { applyRosterHeadcount } = await import("@/modules/cycles");
  const results = await applyRosterHeadcount(tx, { actorId: context.actor.id, requestId: context.requestId, reason });
  return results.filter((result) => result.changed > 0).map(({ cycleName, changed, headcount }) => ({ cycleName, changed, headcount }));
}

/** Did this change alter who gets a vessel on some day? */
const affectsDelivery = (
  before: { status: string; startDate: Date | null } | null,
  after: { status: string; startDate: Date | null },
) =>
  before === null
    ? after.status === "active"
    : (before.status !== after.status && (before.status === "active" || after.status === "active")) ||
      (after.status === "active" && before.startDate?.getTime() !== after.startDate?.getTime());

export async function createSubscriber(input: CreateSubscriberInput, context: Context) {
  assertCan(context.actor, "subscribers:write");
  await assertPlanExists(input.planId);

  return db.$transaction(async (tx) => {
    const row = await tx.subscriber.create({
      data: { ...input, startDate: dateColumn(input.startDate), source: "manual" },
      include,
    });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "subscriber.created",
      entityType: "Subscriber",
      entityId: row.id,
      after: row,
      requestId: context.requestId,
    });
    const servingsChanged = affectsDelivery(null, row) ? await followRoster(tx, context, `${row.name} added`) : [];
    return { ...toSubscriberView(row), servingsChanged };
  });
}

export async function updateSubscriber(id: string, input: UpdateSubscriberInput, context: Context) {
  assertCan(context.actor, "subscribers:write");

  const before = await db.subscriber.findUnique({ where: { id } });
  if (!before) throw notFound("Subscriber", id);
  await assertPlanExists(input.planId);

  return db.$transaction(async (tx) => {
    const row = await tx.subscriber.update({
      where: { id },
      data: { ...input, startDate: dateColumn(input.startDate) },
      include,
    });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "subscriber.updated",
      entityType: "Subscriber",
      entityId: id,
      before,
      after: row,
      requestId: context.requestId,
    });
    const servingsChanged = affectsDelivery(before, row) ? await followRoster(tx, context, `${row.name} changed`) : [];
    return { ...toSubscriberView(row), servingsChanged };
  });
}

/**
 * BR-23: create or refresh the subscriber for a confirmed onboarding
 * submission. Keyed on the submission id, so the onboarding app can retry
 * freely: the first call creates, every later call updates contact and dietary
 * fields and leaves operations' decisions (status, plan, start date, notes)
 * alone.
 */
export async function syncFromOnboarding(submissionId: string, input: OnboardingSyncInput, context: Context) {
  assertCan(context.actor, "subscribers:sync");

  const { synced, createOnly } = fromOnboarding(submissionId, input, new Date());
  const before = await db.subscriber.findUnique({ where: { externalRef: submissionId } });

  return db.$transaction(async (tx) => {
    // A single-column unique `where` lets Prisma issue INSERT … ON CONFLICT, so
    // two concurrent syncs of the same submission cannot create two rows.
    const row = await tx.subscriber.upsert({
      where: { externalRef: submissionId },
      create: { ...synced, ...createOnly, profile: synced.profile as Prisma.InputJsonValue },
      update: { ...synced, profile: synced.profile as Prisma.InputJsonValue },
      include,
    });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: before ? "subscriber.synced" : "subscriber.created",
      entityType: "Subscriber",
      entityId: row.id,
      before: before ?? undefined,
      after: row,
      requestId: context.requestId,
    });
    return { subscriber: toSubscriberView(row), created: !before };
  });
}

/**
 * BR-26 — the delivery list for a production date. Published for the run
 * sheet. Also counts who starts within the next week, so the kitchen sees
 * head-count changes coming.
 */
export async function listDeliveryRoster(date: string) {
  const rows = await db.subscriber.findMany({
    where: { status: "active" },
    include: { plan: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const delivering = rows.filter((row) => deliversOn(row, date));
  const weekAhead = new Date(`${date}T00:00:00Z`);
  weekAhead.setUTCDate(weekAhead.getUTCDate() + 7);
  const startingSoon = rows.filter(
    (row) => !deliversOn(row, date) && row.startDate && row.startDate <= weekAhead,
  ).length;

  return {
    subscribers: delivering.map((row) => ({
      id: row.id,
      name: row.name,
      plan: row.plan?.name ?? null,
      phone: row.phone,
      whatsapp: whatsappNumber(row.phone),
      address: row.address,
      landmark: row.landmark,
      deliveryNote: row.deliveryNote,
      deliverySlot: row.deliverySlot,
      diet: row.diet,
      allergies: row.allergies,
      dislikes: row.dislikes,
      onboardingRef: row.onboardingRef,
      startDate: toDateString(row.startDate),
    })),
    startingSoon,
    capacity: subscriberCapacity(),
  };
}

export type DeliveryRoster = Awaited<ReturnType<typeof listDeliveryRoster>>;

/**
 * BR-30 — how many subscribers get a vessel on each date. Published for the
 * cycle planner's head-count. Takes the caller's transaction handle so a
 * roster change and the servings it implies commit together.
 *
 * `activeTotal` is the number of active subscribers at all: zero means the
 * roster has not been set up yet, not that the kitchen cooks for nobody.
 */
export async function deliveryCounts(dates: string[], client: DbClient = db) {
  const active = await client.subscriber.findMany({ where: { status: "active" }, select: { status: true, startDate: true } });
  const counts: Record<string, number> = {};
  for (const date of new Set(dates)) {
    counts[date] = active.filter((subscriber) => deliversOn(subscriber, date)).length;
  }
  return { counts, activeTotal: active.length };
}
