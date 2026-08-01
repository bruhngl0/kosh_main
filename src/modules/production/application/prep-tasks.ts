import type { PrepTaskType } from "@prisma/client";
// `Prisma` carries both the runtime SQL helpers and the generated types.
import { db, Prisma, type DbClient } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound } from "@/server/errors";
import { toDateString } from "@/shared/money";
import { LEAD_LABEL, derivePrepTasks, type DerivedPrepTask } from "@/modules/production/domain/prep-lead-time";

/**
 * BR-3, BR-16 — advance-prep generation and completion.
 *
 * The previous implementation deleted every OPEN task then recreated them.
 * That destroyed nothing visible but duplicated silently: a task already marked
 * DONE survived the delete and then got a second OPEN twin on every re-run.
 *
 * This version reconciles on the natural key (cycleId, sourceKey):
 *   - a task that still derives from the menu is updated in place,
 *     preserving its completion state
 *   - a task that no longer derives from the menu is removed, but only if
 *     nobody has acted on it
 *   - new tasks are created
 */

type Context = { actor: Actor; requestId: string };

export async function generatePrepTasks(cycleId: string, context: Context) {
  assertCan(context.actor, "cycles:write");

  return db.$transaction(async (tx) => {
    const cycle = await tx.cycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        weekStart: true,
        days: {
          orderBy: { dayNumber: "asc" },
          select: {
            id: true,
            dayNumber: true,
            assignments: {
              select: {
                id: true,
                mealType: true,
                recipeVersion: { select: { steps: { orderBy: { stepNumber: "asc" } } } },
              },
            },
          },
        },
      },
    });
    if (!cycle) throw notFound("Cycle", cycleId);

    const derived = cycle.days.flatMap((day) =>
      day.assignments.flatMap((assignment) =>
        derivePrepTasks({
          cycleDayId: day.id,
          dayNumber: day.dayNumber,
          mealType: assignment.mealType,
          mealAssignmentId: assignment.id,
          steps: assignment.recipeVersion.steps,
          weekStart: cycle.weekStart,
        }),
      ),
    );

    const existing = await tx.prepTask.findMany({
      where: { cycleId },
      select: { id: true, sourceKey: true, status: true },
    });
    const existingKeys = new Set(existing.map((task) => task.sourceKey));
    const derivedKeys = new Set(derived.map((task) => task.sourceKey));

    // Counted from what we already know, so the single upsert below does not
    // have to report per-row outcomes.
    const created = derived.filter((task) => !existingKeys.has(task.sourceKey)).length;
    const updated = derived.length - created;

    await upsertPrepTasks(tx, cycleId, derived);

    // Orphans: the menu changed and this prep is no longer required. Only
    // remove work nobody has touched — a completed task is a record of what
    // actually happened in the kitchen.
    const orphanIds = existing
      .filter((task) => !derivedKeys.has(task.sourceKey) && task.status === "OPEN")
      .map((task) => task.id);
    if (orphanIds.length) await tx.prepTask.deleteMany({ where: { id: { in: orphanIds } } });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "prep.generated",
      entityType: "Cycle",
      entityId: cycleId,
      after: { created, updated, removed: orphanIds.length, total: derived.length },
      requestId: context.requestId,
    });

    return { created, updated, removed: orphanIds.length, total: derived.length };
  });
}

/**
 * Writes every derived task in one statement.
 *
 * A per-task create/update loop cost ~150 round trips inside a single
 * transaction for a 28-day cycle. That is invisible against local PostgreSQL at
 * ~1ms, but at Neon latencies it exceeds Prisma's 5s interactive transaction
 * timeout — an endpoint that passes locally and fails in production.
 *
 * The ON CONFLICT clause deliberately leaves `status`, `completed_by_id`, and
 * `completed_at` alone: regeneration must never undo work the kitchen has
 * already done (BR-16).
 */
async function upsertPrepTasks(tx: DbClient, cycleId: string, tasks: DerivedPrepTask[]) {
  // PostgreSQL caps a statement at 65535 bind parameters; at 8 per row this is
  // far below it, while keeping any single statement a reasonable size.
  const CHUNK_SIZE = 500;

  for (let offset = 0; offset < tasks.length; offset += CHUNK_SIZE) {
    const chunk = tasks.slice(offset, offset + CHUNK_SIZE);

    const values = chunk.map(
      (task) => Prisma.sql`(
        gen_random_uuid(),
        ${cycleId}::uuid,
        ${task.cycleDayId}::uuid,
        ${task.mealAssignmentId}::uuid,
        ${task.sourceKey},
        ${task.taskText},
        ${task.taskType}::"PrepTaskType",
        ${task.dueDate}::date,
        ${task.urgent},
        NOW()
      )`,
    );

    await tx.$executeRaw`
      INSERT INTO prep_tasks (
        id, cycle_id, cycle_day_id, meal_assignment_id,
        source_key, task_text, task_type, due_date, urgent, updated_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (cycle_id, source_key) DO UPDATE SET
        cycle_day_id       = EXCLUDED.cycle_day_id,
        meal_assignment_id = EXCLUDED.meal_assignment_id,
        task_text          = EXCLUDED.task_text,
        task_type          = EXCLUDED.task_type,
        due_date           = EXCLUDED.due_date,
        urgent             = EXCLUDED.urgent,
        updated_at         = NOW()
    `;
  }
}

export async function updatePrepTask(id: string, status: "OPEN" | "DONE" | "SKIPPED", context: Context) {
  assertCan(context.actor, "production:write");

  return db.$transaction(async (tx) => {
    const before = await tx.prepTask.findUnique({ where: { id } });
    if (!before) throw notFound("Prep task", id);

    const done = status === "DONE";
    const after = await tx.prepTask.update({
      where: { id },
      data: {
        status,
        completedAt: done ? new Date() : null,
        // Attribution: who actually did the work (§8.1).
        completedById: done ? context.actor.id : null,
      },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "prep.updated",
      entityType: "PrepTask",
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
      requestId: context.requestId,
    });

    return toPrepTaskView(after);
  });
}

export async function listPrepTasks(
  cycleId: string,
  filter: { status?: string; week?: number; urgentOnly?: boolean } = {},
) {
  const where: Prisma.PrepTaskWhereInput = {
    cycleId,
    ...(filter.status ? { status: filter.status as never } : {}),
    ...(filter.urgentOnly ? { urgent: true } : {}),
    ...(filter.week ? { cycleDay: { weekNumber: filter.week } } : {}),
  };

  const tasks = await db.prepTask.findMany({
    where,
    include: {
      cycleDay: { select: { dayNumber: true, weekNumber: true } },
      assignment: {
        select: { mealType: true, recipeVersion: { select: { recipe: { select: { title: true } } } } },
      },
      completedBy: { select: { id: true, name: true } },
    },
    // Undated tasks sort last rather than first.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { urgent: "desc" }, { createdAt: "asc" }],
  });

  return tasks.map((task) => ({
    ...toPrepTaskView(task),
    dayNumber: task.cycleDay.dayNumber,
    weekNumber: task.cycleDay.weekNumber,
    mealType: task.assignment?.mealType ?? null,
    dishTitle: task.assignment?.recipeVersion.recipe.title ?? null,
    completedBy: task.completedBy?.name ?? null,
  }));
}

function toPrepTaskView(task: {
  id: string;
  sourceKey: string;
  taskText: string;
  taskType: PrepTaskType;
  dueDate: Date | null;
  urgent: boolean;
  status: string;
  completedAt: Date | null;
}) {
  return {
    id: task.id,
    sourceKey: task.sourceKey,
    text: task.taskText,
    taskType: task.taskType,
    leadLabel: LEAD_LABEL[task.taskType],
    dueDate: toDateString(task.dueDate),
    urgent: task.urgent,
    status: task.status,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}
