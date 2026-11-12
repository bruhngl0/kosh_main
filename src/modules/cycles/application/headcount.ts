import { db, type DbClient } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound } from "@/server/errors";
import { kitchenDate } from "@/shared/kitchen-date";
import { toDateString } from "@/shared/money";
import { deliveryCounts } from "@/modules/subscribers";
import { datesNeeded, headlineDate, planHeadcount, type HeadcountDay } from "@/modules/cycles/domain/headcount";

/**
 * BR-30 — keeping cycle servings in line with the subscriber roster.
 *
 * Runs automatically inside the transaction of any roster change that alters
 * who is delivered to (subscribers module), and on demand from the planner.
 * Only DRAFT and ACTIVE cycles follow the roster; CLOSED and ARCHIVED cycles
 * are history.
 */

type Audit = { actorId: string | null; requestId: string; reason: string };

export type HeadcountResult = {
  cycleId: string;
  cycleName: string;
  /** "roster" when servings follow the roster; "cycle" when it is empty and the typed count stands. */
  source: "roster" | "cycle";
  headcount: number;
  changed: number;
};

const dateFor = (weekStart: Date | null, dayNumber: number) => {
  if (!weekStart) return null;
  const date = new Date(weekStart);
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return toDateString(date);
};

/** Applies BR-30 to the given open cycles (all open cycles when omitted), in the caller's transaction. */
export async function applyRosterHeadcount(tx: DbClient, audit: Audit, cycleIds?: string[]): Promise<HeadcountResult[]> {
  const today = kitchenDate(new Date());
  const cycles = await tx.cycle.findMany({
    where: { status: { in: ["DRAFT", "ACTIVE"] }, ...(cycleIds ? { id: { in: cycleIds } } : {}) },
    select: {
      id: true,
      name: true,
      weekStart: true,
      subscriberCount: true,
      days: {
        select: {
          dayNumber: true,
          assignments: { select: { id: true, servings: true, servingsLocked: true } },
        },
      },
    },
  });
  if (!cycles.length) return [];

  const shaped = cycles.map((cycle) => {
    const weekStart = toDateString(cycle.weekStart);
    const days: HeadcountDay[] = cycle.days.map((day) => ({
      dayNumber: day.dayNumber,
      date: dateFor(cycle.weekStart, day.dayNumber),
      assignments: day.assignments.map((a) => ({ id: a.id, servings: a.servings, locked: a.servingsLocked })),
    }));
    return { cycle, days, headline: headlineDate(weekStart, today) };
  });

  // One roster read for every date any cycle needs.
  const { counts, activeTotal } = await deliveryCounts(
    shaped.flatMap(({ days, headline }) => [...datesNeeded(days, today), headline]),
    tx,
  );

  if (activeTotal === 0) {
    // The roster has not been set up: the typed head-count stays in charge.
    return shaped.map(({ cycle }) => ({
      cycleId: cycle.id,
      cycleName: cycle.name,
      source: "cycle" as const,
      headcount: cycle.subscriberCount,
      changed: 0,
    }));
  }

  const results: HeadcountResult[] = [];
  for (const { cycle, days, headline } of shaped) {
    const changes = planHeadcount(days, today, counts);
    const headcount = Math.max(1, counts[headline] ?? 0);

    // Few distinct targets per cycle, so one UPDATE per target value.
    const byTarget = new Map<number, string[]>();
    for (const change of changes) byTarget.set(change.to, [...(byTarget.get(change.to) ?? []), change.assignmentId]);
    for (const [servings, ids] of byTarget) {
      await tx.mealAssignment.updateMany({ where: { id: { in: ids } }, data: { servings } });
    }

    await tx.cycle.update({ where: { id: cycle.id }, data: { subscriberCount: headcount, headcountSyncedAt: new Date() } });

    if (changes.length || headcount !== cycle.subscriberCount) {
      await recordAudit(tx, {
        actorId: audit.actorId,
        action: "cycle.headcount_synced",
        entityType: "Cycle",
        entityId: cycle.id,
        before: { subscriberCount: cycle.subscriberCount },
        after: {
          subscriberCount: headcount,
          reason: audit.reason,
          changed: changes.length,
          days: [...new Set(changes.map((c) => c.dayNumber))],
        },
        requestId: audit.requestId,
      });
    }

    results.push({ cycleId: cycle.id, cycleName: cycle.name, source: "roster", headcount, changed: changes.length });
  }
  return results;
}

/** The planner's "Sync from roster" button. */
export async function syncCycleHeadcount(cycleId: string, context: { actor: Actor; requestId: string }) {
  assertCan(context.actor, "cycles:write");

  return db.$transaction(async (tx) => {
    const cycle = await tx.cycle.findUnique({ where: { id: cycleId }, select: { id: true, name: true, status: true, subscriberCount: true } });
    if (!cycle) throw notFound("Cycle", cycleId);

    const [result] = await applyRosterHeadcount(
      tx,
      { actorId: context.actor.id, requestId: context.requestId, reason: "manual sync" },
      [cycleId],
    );
    // CLOSED and ARCHIVED cycles are history and do not follow the roster.
    return (
      result ?? { cycleId, cycleName: cycle.name, source: "cycle" as const, headcount: cycle.subscriberCount, changed: 0, closed: true }
    );
  });
}

/** Default servings for a slot being filled: the roster count for its date, or the typed count before the roster exists. */
export async function rosterServingsFor(tx: DbClient, weekStart: Date | null, dayNumber: number, fallback: number) {
  const today = kitchenDate(new Date());
  const date = dateFor(weekStart, dayNumber) ?? today;
  const { counts, activeTotal } = await deliveryCounts([date], tx);
  return activeTotal === 0 ? fallback : Math.max(1, counts[date] ?? 0);
}
