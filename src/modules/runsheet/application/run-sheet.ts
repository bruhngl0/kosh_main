import { Prisma } from "@prisma/client";
import { db, type DbClient } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound, unprocessable } from "@/server/errors";
import { getCycleDateRanges, getMenuForDate, MEAL_NAMES, type MealType } from "@/modules/cycles";
import { listPrepDueOn, previewDayStock } from "@/modules/production";
import { listDeliveryRoster } from "@/modules/subscribers";
import { kitsForSubscribers, recordSanitised } from "@/modules/vessels";
import { CHECKLIST, DERIVED_TASK_IDS, isStandardTask, SANITISE_TASK_ID } from "@/modules/runsheet/domain/checklist";
import { findClashes } from "@/modules/runsheet/domain/allergens";
import type {
  AddRunSheetTaskInput,
  SetCheckInput,
  UpdateRunSheetInput,
  VesselState,
} from "@/shared/schemas/run-sheet";

/**
 * BR-26..BR-29 — the daily production run sheet.
 *
 * Everything the kitchen needs to know is derived on read: the cycle day and
 * its menu (cycles), who is delivered to (subscribers), what advance prep is
 * due (production), and who clashes with which dish. Only what the kitchen
 * DOES on the day is stored: ticks, added tasks, vessel movements, notes.
 * Two actions reach into other modules: recording production takes the day
 * off stock (BR-31, production → inventory), and the evening wash tick stamps
 * vessel kits as sanitised (BR-32, vessels).
 * The row for a date is created by its first write, so browsing ahead or back
 * leaves nothing behind.
 */

type Context = { actor: Actor; requestId: string };

const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

// ── Read ─────────────────────────────────────────────────────────────────────

export type RunSheetView = Awaited<ReturnType<typeof getRunSheet>>;

export async function getRunSheet(date: string) {
  const [menu, roster, prep, sheet] = await Promise.all([
    getMenuForDate(date),
    listDeliveryRoster(date),
    listPrepDueOn(date),
    db.runSheet.findUnique({
      where: { productionDate: asDate(date) },
      include: {
        checks: { include: { doneBy: { select: { name: true } } } },
        tasks: { orderBy: { createdAt: "asc" } },
        dispatches: true,
      },
    }),
  ]);

  const rosterIds = roster.subscribers.map((s) => s.id);
  const [stock, kits, missingSince] = await Promise.all([
    menu ? previewDayStock({ cycleId: menu.cycle.id, dayNumber: menu.dayNumber }) : null,
    kitsForSubscribers(rosterIds),
    vesselsStillMissing(rosterIds, date),
  ]);

  const meals = menu?.meals ?? [];
  const sum = (pick: (meal: (typeof meals)[number]) => number | null) =>
    meals.length && meals.every((meal) => pick(meal) !== null)
      ? Math.round(meals.reduce((total, meal) => total + (pick(meal) ?? 0), 0))
      : null;

  const dishes = meals.map((meal) => ({ mealType: meal.mealType, title: meal.title, allergens: meal.allergens }));
  const allergyAlerts = roster.subscribers.flatMap((subscriber) => {
    if (!subscriber.allergies.length) return [];
    const { clashes, unrecognised } = findClashes(subscriber.allergies, dishes);
    if (!clashes.length && !unrecognised.length) return [];
    return [
      {
        subscriberId: subscriber.id,
        name: subscriber.name,
        clashes: clashes.map((clash) => ({ ...clash, meal: MEAL_NAMES[clash.mealType as MealType] })),
        unrecognised,
      },
    ];
  });

  const checks = new Map(sheet?.checks.map((check) => [check.taskKey, check]) ?? []);
  const productionDone = Boolean(stock && stock.assignedMeals.length && !stock.pendingMeals.length);
  const lastRun = stock?.runs.at(-1);
  const doneInfo = (key: string) => {
    if (DERIVED_TASK_IDS.has(key)) {
      return productionDone
        ? { done: true, doneBy: lastRun?.recordedBy ?? null, doneAt: lastRun?.recordedAt ?? null }
        : { done: false, doneBy: null, doneAt: null };
    }
    const check = checks.get(key);
    return check ? { done: true, doneBy: check.doneBy?.name ?? null, doneAt: check.doneAt.toISOString() } : { done: false, doneBy: null, doneAt: null };
  };

  const phases = CHECKLIST.map((phase) => ({
    id: phase.id,
    name: phase.name,
    window: phase.window,
    tasks: [
      ...phase.tasks.map((task) => ({
        key: task.id,
        title: task.title,
        sub: task.sub ?? null,
        owner: task.owner,
        time: task.time,
        critical: task.critical ?? false,
        vessel: task.vessel ?? false,
        custom: false,
        derived: Boolean(task.derived),
        ...doneInfo(task.id),
      })),
      ...(sheet?.tasks ?? [])
        .filter((task) => task.phase === phase.id)
        .map((task) => ({
          key: task.id,
          title: task.title,
          sub: null,
          owner: task.owner,
          time: "—",
          critical: false,
          vessel: false,
          custom: true,
          derived: false,
          ...doneInfo(task.id),
        })),
    ],
  }));

  const dispatchBySubscriber = new Map(sheet?.dispatches.map((d) => [d.subscriberId, d.status as VesselState]) ?? []);
  const plans = new Map<string, number>();
  for (const subscriber of roster.subscribers) {
    const plan = subscriber.plan ?? "No plan";
    plans.set(plan, (plans.get(plan) ?? 0) + 1);
  }

  const allTasks = phases.flatMap((phase) => phase.tasks);
  const weekday = asDate(date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return {
    date,
    weekday,
    saved: Boolean(sheet),
    brief: {
      chefName: sheet?.chefName ?? null,
      defaultChef: menu?.cycle.chefName ?? null,
      dispatchWindow: sheet?.dispatchWindow ?? null,
      specialNotes: sheet?.specialNotes ?? null,
      notes: sheet?.notes ?? null,
    },
    cycle: menu
      ? {
          ...menu.cycle,
          dayNumber: menu.dayNumber,
          weekNumber: menu.weekNumber,
          phaseLabel: menu.phaseLabel,
        }
      : null,
    /** Where cycles do run, when none covers this date. */
    cycleRanges: menu ? [] : await getCycleDateRanges(),
    meals,
    macros: {
      kcal: sum((meal) => meal.kcal),
      protein: sum((meal) => meal.proteinGrams),
      carbs: sum((meal) => meal.carbsGrams),
      fat: sum((meal) => meal.fatGrams),
    },
    roster: {
      count: roster.subscribers.length,
      capacity: roster.capacity,
      startingSoon: roster.startingSoon,
      planSplit: [...plans.entries()].map(([plan, count]) => ({ plan, count })).sort((a, b) => b.count - a.count),
      // Servings planned on the cycle can drift from the real roster (runbook known limitation).
      plannedServings: menu ? Math.max(0, ...meals.map((meal) => meal.servings)) : null,
    },
    allergyAlerts,
    prep,
    stock,
    phases,
    progress: { done: allTasks.filter((task) => task.done).length, total: allTasks.length },
    vessels: roster.subscribers.map((subscriber) => ({
      ...subscriber,
      vessel: dispatchBySubscriber.get(subscriber.id) ?? null,
      flagged: allergyAlerts.some((alert) => alert.subscriberId === subscriber.id && alert.clashes.length > 0),
      kit: kitView(kits.get(subscriber.id)),
      missingSince: missingSince.get(subscriber.id) ?? null,
    })),
  };
}

type Kit = ReturnType<Awaited<ReturnType<typeof kitsForSubscribers>>["get"]>;

function kitView(kit: Kit) {
  if (!kit) return null;
  return {
    id: kit.id,
    type: kit.type,
    status: kit.status,
    sets: kit.sets,
    sanitisedAt: kit.sanitisedAt,
    sanitisationOverdue: kit.sanitisationOverdue,
  };
}

/**
 * BR-32 — vessels marked missing on an earlier day and not seen since. For
 * each subscriber, walks their recent days back from the latest: a trailing
 * run of "missing" gives the first day it went missing. Any later dispatch or
 * collection ends the run.
 */
async function vesselsStillMissing(subscriberIds: string[], date: string) {
  const since = asDate(date);
  since.setUTCDate(since.getUTCDate() - 30);
  const rows = await db.vesselDispatch.findMany({
    where: { subscriberId: { in: subscriberIds }, runSheet: { productionDate: { lt: asDate(date), gte: since } } },
    select: { subscriberId: true, status: true, runSheet: { select: { productionDate: true } } },
    orderBy: { runSheet: { productionDate: "desc" } },
  });
  const result = new Map<string, string>();
  const settled = new Set<string>();
  for (const row of rows) {
    if (settled.has(row.subscriberId)) continue;
    if (row.status === "missing") result.set(row.subscriberId, row.runSheet.productionDate.toISOString().slice(0, 10));
    else settled.add(row.subscriberId);
  }
  return result;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * The run sheet row for a date, created if this is the day's first write.
 *
 * INSERT … ON CONFLICT DO NOTHING, then read: neither statement locks the
 * row, so people ticking at the same moment do not queue behind each other.
 * (Prisma's upsert with nothing to update reads then creates, and races on
 * the unique date; DO UPDATE would take a row lock every write then waits on.)
 * If a concurrent first write is still in flight, the INSERT waits for it to
 * commit, so the read that follows always finds the row.
 */
async function ensureSheet(tx: DbClient, date: string): Promise<{ id: string }> {
  await tx.$executeRaw`
    INSERT INTO run_sheets (id, production_date, updated_at)
    VALUES (gen_random_uuid(), ${date}::date, NOW())
    ON CONFLICT (production_date) DO NOTHING
  `;
  return tx.runSheet.findUniqueOrThrow({ where: { productionDate: asDate(date) }, select: { id: true } });
}

export async function updateRunSheet(date: string, input: UpdateRunSheetInput, context: Context) {
  assertCan(context.actor, "production:write");

  return db.$transaction(async (tx) => {
    const before = await tx.runSheet.findUnique({ where: { productionDate: asDate(date) } });
    const { id } = await ensureSheet(tx, date);
    const sheet = await tx.runSheet.update({ where: { id }, data: input });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "run_sheet.updated",
      entityType: "RunSheet",
      entityId: sheet.id,
      before: before ?? undefined,
      after: sheet,
      requestId: context.requestId,
    });
    return { chefName: sheet.chefName, dispatchWindow: sheet.dispatchWindow, specialNotes: sheet.specialNotes, notes: sheet.notes };
  });
}

/**
 * BR-27 — tick or untick one task, or tick everything at once. The tick row
 * records who and when, which is the attribution; ticks are not audited
 * individually, they would drown the trail.
 */
export async function setCheck(date: string, input: SetCheckInput, context: Context) {
  assertCan(context.actor, "production:write");

  return db.$transaction(async (tx) => {
    const sheet = await ensureSheet(tx, date);
    const custom = await tx.runSheetTask.findMany({ where: { runSheetId: sheet.id }, select: { id: true } });
    const customIds = new Set(custom.map((task) => task.id));

    if ("all" in input) {
      const keys = [
        ...CHECKLIST.flatMap((phase) => phase.tasks.map((task) => task.id)).filter((key) => !DERIVED_TASK_IDS.has(key)),
        ...customIds,
      ];
      const { count } = await tx.runSheetCheck.createMany({
        data: keys.map((taskKey) => ({ runSheetId: sheet.id, taskKey, doneById: context.actor.id })),
        skipDuplicates: true,
      });
      const sanitised = await sanitiseCollected(tx, sheet.id, date, context);
      return { ticked: count, sanitised };
    }

    if (!isStandardTask(input.taskKey) && !customIds.has(input.taskKey)) {
      throw notFound("Run sheet task", input.taskKey);
    }
    if (DERIVED_TASK_IDS.has(input.taskKey)) {
      throw unprocessable("This task ticks itself when today's production is recorded against stock.", { taskKey: input.taskKey });
    }

    if (input.done) {
      // ON CONFLICT DO NOTHING: a second tick keeps the first person's attribution.
      await tx.runSheetCheck.createMany({
        data: [{ runSheetId: sheet.id, taskKey: input.taskKey, doneById: context.actor.id }],
        skipDuplicates: true,
      });
      if (input.taskKey === SANITISE_TASK_ID) {
        return { taskKey: input.taskKey, done: true, sanitised: await sanitiseCollected(tx, sheet.id, date, context) };
      }
    } else {
      await tx.runSheetCheck.deleteMany({ where: { runSheetId: sheet.id, taskKey: input.taskKey } });
    }
    return { taskKey: input.taskKey, done: input.done };
  });
}

export async function addRunSheetTask(date: string, input: AddRunSheetTaskInput, context: Context) {
  assertCan(context.actor, "production:write");

  return db.$transaction(async (tx) => {
    const sheet = await ensureSheet(tx, date);
    const task = await tx.runSheetTask.create({ data: { runSheetId: sheet.id, ...input } });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "run_sheet.task_added",
      entityType: "RunSheet",
      entityId: sheet.id,
      after: task,
      requestId: context.requestId,
    });
    return task;
  });
}

/** Only tasks added by hand can be removed; the standard checklist is BR-27. */
export async function removeRunSheetTask(date: string, taskId: string, context: Context) {
  assertCan(context.actor, "production:write");

  return db.$transaction(async (tx) => {
    const task = await tx.runSheetTask.findFirst({
      where: { id: taskId, runSheet: { productionDate: asDate(date) } },
    });
    if (!task) throw notFound("Added task", taskId);
    await tx.runSheetCheck.deleteMany({ where: { runSheetId: task.runSheetId, taskKey: task.id } });
    await tx.runSheetTask.delete({ where: { id: task.id } });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "run_sheet.task_removed",
      entityType: "RunSheet",
      entityId: task.runSheetId,
      before: task,
      requestId: context.requestId,
    });
  });
}

/** BR-28 — where a subscriber's vessel is today. null puts it back to "not dispatched". */
export async function setVesselState(date: string, subscriberId: string, status: VesselState | null, context: Context) {
  assertCan(context.actor, "production:write");

  try {
    return await db.$transaction(async (tx) => {
      const sheet = await ensureSheet(tx, date);
      const key = { runSheetId_subscriberId: { runSheetId: sheet.id, subscriberId } };
      if (status === null) {
        await tx.vesselDispatch.deleteMany({ where: { runSheetId: sheet.id, subscriberId } });
      } else {
        await tx.vesselDispatch.upsert({
          where: key,
          create: { runSheetId: sheet.id, subscriberId, status, updatedById: context.actor.id },
          update: { status, updatedById: context.actor.id },
        });
      }
      // A vessel logged as collected after the wash was already ticked went
      // through that wash too.
      const washed =
        status === "collected" &&
        (await tx.runSheetCheck.count({ where: { runSheetId: sheet.id, taskKey: SANITISE_TASK_ID } })) > 0;
      const sanitised = washed
        ? await recordSanitised(tx, [subscriberId], date, { actorId: context.actor.id, requestId: context.requestId })
        : 0;
      return { subscriberId, status, sanitised };
    });
  } catch (error) {
    // The subscriber id did not exist: a foreign-key violation, not a server fault.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw notFound("Subscriber", subscriberId);
    }
    throw error;
  }
}

/** BR-32 — the wash ran: every vessel collected today is now sanitised. */
async function sanitiseCollected(tx: DbClient, runSheetId: string, date: string, context: Context) {
  const collected = await tx.vesselDispatch.findMany({ where: { runSheetId, status: "collected" }, select: { subscriberId: true } });
  return recordSanitised(
    tx,
    collected.map((row) => row.subscriberId),
    date,
    { actorId: context.actor.id, requestId: context.requestId },
  );
}

/** Guard used by the route: a run sheet for a date years away is a typo, not a plan. */
export function assertReasonableDate(date: string, today: string) {
  const days = Math.abs(Date.parse(date) - Date.parse(today)) / 86_400_000;
  if (days > 366) {
    throw unprocessable("Pick a date within a year of today.", { date });
  }
}
