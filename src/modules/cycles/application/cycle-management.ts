import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";
import {
  buildCycleDays,
  canTransitionCycle,
  describePublishProblem,
  isDeletable,
  validatePublish,
} from "@/modules/cycles/domain/cycle";
import type { CreateCycleInput, UpdateCycleInput } from "@/shared/schemas/cycle";
import * as repository from "@/modules/cycles/infrastructure/cycle-repository";
import { applyRosterHeadcount } from "@/modules/cycles/application/headcount";

/**
 * Cycle lifecycle use cases. See docs/system-design.md §4.1.
 * Each owns its transaction and writes an audit event inside it.
 */

type Context = { actor: Actor; requestId: string };

export async function createCycle(input: CreateCycleInput, context: Context) {
  assertCan(context.actor, "cycles:write");

  const existing = await repository.findCycleByNumber(db, input.cycleNumber);
  if (existing) {
    throw conflict(`Cycle number ${input.cycleNumber} is already used by ${existing.name}.`, {
      cycleNumber: input.cycleNumber,
      existingCycleId: existing.id,
    });
  }

  return db.$transaction(async (tx) => {
    const cycle = await repository.createCycleWithDays(tx, {
      name: input.name,
      cycleNumber: input.cycleNumber,
      durationDays: input.durationDays,
      weekStart: input.weekStart,
      subscriberCount: input.subscriberCount,
      foodCostTargetPercent: input.foodCostTargetPercent,
      chefName: input.chefName,
      proteinWindowDays: input.proteinWindowDays,
      days: { create: buildCycleDays(input.durationDays) },
    });

    // BR-30: a new cycle starts at the roster's head-count when there is one.
    const [headcount] = await applyRosterHeadcount(tx, { actorId: context.actor.id, requestId: context.requestId, reason: "cycle created" }, [cycle.id]);
    if (headcount) cycle.subscriberCount = headcount.headcount;

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cycle.created",
      entityType: "Cycle",
      entityId: cycle.id,
      after: { ...cycle, days: cycle.days.length },
      requestId: context.requestId,
    });

    return cycle;
  });
}

export async function updateCycle(id: string, input: UpdateCycleInput, context: Context) {
  assertCan(context.actor, "cycles:write");

  const before = await repository.findCycleMeta(db, id);
  if (!before) throw notFound("Cycle", id);

  return db.$transaction(async (tx) => {
    let after = await repository.updateCycle(tx, id, {
      name: input.name,
      weekStart: input.weekStart,
      subscriberCount: input.subscriberCount,
      foodCostTargetPercent: input.foodCostTargetPercent,
      chefName: input.chefName,
      proteinWindowDays: input.proteinWindowDays,
    });

    // BR-30: moving the start date moves which roster day each meal falls on,
    // and a typed head-count only stands while the roster is empty.
    if (input.weekStart !== undefined || input.subscriberCount !== undefined) {
      await applyRosterHeadcount(tx, { actorId: context.actor.id, requestId: context.requestId, reason: "cycle updated" }, [id]);
      after = (await repository.findCycleMeta(tx, id)) ?? after;
    }

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cycle.updated",
      entityType: "Cycle",
      entityId: id,
      before,
      after,
      requestId: context.requestId,
    });

    return after;
  });
}

/**
 * BR-4. Validates every slot before activating, in one transaction so a cycle
 * cannot be edited into an invalid state between the check and the write.
 */
export async function publishCycle(id: string, context: Context) {
  assertCan(context.actor, "cycles:write");

  return db.$transaction(async (tx) => {
    const summary = await repository.findPublishSummary(tx, id);
    if (!summary) throw notFound("Cycle", id);

    if (summary.status !== "DRAFT") {
      throw unprocessable(`Cycle "${summary.name}" is already ${summary.status.toLowerCase()}.`, {
        status: summary.status,
      });
    }

    const validation = validatePublish(
      summary.days.map((day) => ({
        dayNumber: day.dayNumber,
        assignments: day.assignments.map((assignment) => ({
          mealType: assignment.mealType,
          recipeVersionStatus: assignment.recipeVersion.status,
          recipeActive: assignment.recipeVersion.recipe.active,
        })),
      })),
    );

    if (!validation.valid) {
      // A 422 with the offending days, not a 200 carrying `published: false`.
      throw unprocessable("This cycle cannot be published yet.", {
        problems: validation.problems.map((problem) => ({
          ...problem,
          message: describePublishProblem(problem),
        })),
        incompleteDayNumbers: validation.incompleteDayNumbers,
      });
    }

    const published = await repository.updateCycle(tx, id, {
      status: "ACTIVE",
      publishedAt: new Date(),
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cycle.published",
      entityType: "Cycle",
      entityId: id,
      before: { status: summary.status },
      after: { status: published.status, publishedAt: published.publishedAt },
      requestId: context.requestId,
    });

    return published;
  });
}

/**
 * ACTIVE → CLOSED. A closed cycle is history: it stops following the roster
 * (BR-30) and its servings are frozen, but it still shows on the run sheet for
 * its own dates.
 */
export async function closeCycle(id: string, context: Context) {
  assertCan(context.actor, "cycles:write");

  return db.$transaction(async (tx) => {
    const before = await repository.findCycleMeta(tx, id);
    if (!before) throw notFound("Cycle", id);

    if (!canTransitionCycle(before.status, "CLOSED")) {
      throw unprocessable(
        before.status === "DRAFT"
          ? `Cycle "${before.name}" has not been published, so there is nothing to close.`
          : `Cycle "${before.name}" is already ${before.status.toLowerCase()}.`,
        { status: before.status },
      );
    }

    const closed = await repository.updateCycle(tx, id, { status: "CLOSED" });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cycle.closed",
      entityType: "Cycle",
      entityId: id,
      before: { status: before.status },
      after: { status: closed.status },
      requestId: context.requestId,
    });

    return closed;
  });
}

export async function deleteCycle(id: string, context: Context) {
  assertCan(context.actor, "cycles:write");

  const cycle = await repository.findCycleMeta(db, id);
  if (!cycle) throw notFound("Cycle", id);

  if (!isDeletable(cycle.status)) {
    throw unprocessable("Only draft cycles can be deleted.", { status: cycle.status });
  }

  return db.$transaction(async (tx) => {
    // Audit first: after the delete the row is gone and the FK would fail.
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "cycle.deleted",
      entityType: "Cycle",
      entityId: id,
      before: cycle,
      requestId: context.requestId,
    });

    await repository.deleteCycle(tx, id);
    return { id, name: cycle.name, deleted: true };
  });
}
