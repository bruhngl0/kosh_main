import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound } from "@/server/errors";
import { toDateString } from "@/shared/money";
import type { CreateVesselKitInput, UpdateVesselKitInput } from "@/shared/schemas/inventory";

/** BR-18 — subscriber vessel kit registry and rotation. */

type Context = { actor: Actor; requestId: string };

/** Days after which a kit in circulation is flagged for sanitisation. */
const SANITISATION_INTERVAL_DAYS = 30;

export async function createVesselKit(input: CreateVesselKitInput, context: Context) {
  assertCan(context.actor, "vessels:write");

  return db.$transaction(async (tx) => {
    let subscriberId = input.subscriberId;

    if (!subscriberId) {
      // Reuse an existing subscriber with this name rather than forking a
      // duplicate, which is what the previous implementation did on every call.
      const existing = await tx.subscriber.findFirst({
        where: { name: input.subscriberName! },
        select: { id: true },
      });
      subscriberId =
        existing?.id ?? (await tx.subscriber.create({ data: { name: input.subscriberName! } })).id;
    } else {
      const subscriber = await tx.subscriber.findUnique({ where: { id: subscriberId }, select: { id: true } });
      if (!subscriber) throw notFound("Subscriber", subscriberId);
    }

    const kit = await tx.vesselKit.create({
      data: {
        subscriberId,
        type: input.type,
        status: input.status,
        sets: input.sets,
        issuedAt: input.issuedAt,
        sanitisedAt: input.sanitisedAt,
        notes: input.notes,
      },
      include: { subscriber: true },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "vessel_kit.created",
      entityType: "VesselKit",
      entityId: kit.id,
      after: kit,
      requestId: context.requestId,
    });

    return toKitView(kit);
  });
}

export async function updateVesselKit(id: string, input: UpdateVesselKitInput, context: Context) {
  assertCan(context.actor, "vessels:write");

  const before = await db.vesselKit.findUnique({ where: { id } });
  if (!before) throw notFound("Vessel kit", id);

  return db.$transaction(async (tx) => {
    const kit = await tx.vesselKit.update({
      where: { id },
      data: input,
      include: { subscriber: true },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "vessel_kit.updated",
      entityType: "VesselKit",
      entityId: id,
      before,
      after: kit,
      requestId: context.requestId,
    });

    return toKitView(kit);
  });
}

export async function listVesselKits(filter: { status?: string } = {}) {
  const kits = await db.vesselKit.findMany({
    where: filter.status ? { status: filter.status } : {},
    include: { subscriber: true },
    orderBy: { subscriber: { name: "asc" } },
  });
  return kits.map(toKitView);
}

export async function getVesselSummary() {
  const kits = await listVesselKits();
  const overdue = kits.filter((kit) => kit.sanitisationOverdue);

  return {
    totalKits: kits.length,
    totalSets: kits.reduce((sum, kit) => sum + kit.sets, 0),
    active: kits.filter((kit) => kit.status === "active").length,
    needsReplacement: kits.filter((kit) => kit.status === "needs-replace").length,
    retired: kits.filter((kit) => kit.status === "retired").length,
    sanitisationOverdue: overdue.length,
    overdueKits: overdue,
  };
}

type KitRow = {
  id: string;
  type: string;
  status: string;
  sets: number;
  issuedAt: Date | null;
  sanitisedAt: Date | null;
  notes: string | null;
  subscriberId: string;
  subscriber: { id: string; name: string; status: string };
};

function toKitView(kit: KitRow) {
  const daysSinceSanitised = kit.sanitisedAt
    ? Math.floor((Date.now() - kit.sanitisedAt.getTime()) / 86_400_000)
    : null;

  return {
    id: kit.id,
    subscriberId: kit.subscriberId,
    subscriberName: kit.subscriber.name,
    subscriberStatus: kit.subscriber.status,
    type: kit.type,
    typeLabel: kit.type === "copper" ? "Copper (tin-lined)" : "Stainless steel (18/8)",
    status: kit.status,
    sets: kit.sets,
    issuedAt: toDateString(kit.issuedAt),
    sanitisedAt: toDateString(kit.sanitisedAt),
    daysSinceSanitised,
    // Retired kits are out of circulation, so they cannot be overdue.
    sanitisationOverdue:
      kit.status !== "retired" &&
      (daysSinceSanitised === null || daysSinceSanitised > SANITISATION_INTERVAL_DAYS),
    notes: kit.notes,
  };
}
