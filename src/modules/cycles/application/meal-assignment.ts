import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound, unprocessable } from "@/server/errors";
import { MEAL_NAMES, isSlotCompatible, type MealType } from "@/modules/cycles/domain/cycle";
import type { AssignMealInput } from "@/shared/schemas/cycle";
import * as repository from "@/modules/cycles/infrastructure/cycle-repository";

type Context = { actor: Actor; requestId: string };

type AssignTarget = { cycleId: string; dayNumber: number; mealType: MealType };

/**
 * BR-5 — a recipe version may only fill a slot matching its meal type.
 *
 * The previous implementation cast the path parameter straight into Prisma, so
 * an unknown meal produced a database error surfaced as a 500, and a lunch
 * recipe could be assigned to breakfast.
 */
export async function assignMeal(target: AssignTarget, input: AssignMealInput, context: Context) {
  assertCan(context.actor, "cycles:write");

  return db.$transaction(async (tx) => {
    const cycle = await repository.findCycleMeta(tx, target.cycleId);
    if (!cycle) throw notFound("Cycle", target.cycleId);

    const day = await repository.findCycleDay(tx, target.cycleId, target.dayNumber);
    if (!day) throw notFound(`Day ${target.dayNumber} of this cycle`);

    const version = await tx.recipeVersion.findUnique({
      where: { id: input.recipeVersionId },
      select: {
        id: true,
        status: true,
        versionNumber: true,
        recipe: { select: { id: true, title: true, mealType: true, active: true } },
      },
    });
    if (!version) throw notFound("Recipe version", input.recipeVersionId);

    if (!version.recipe.active) {
      throw unprocessable(`"${version.recipe.title}" has been archived and cannot be assigned.`);
    }

    if (!isSlotCompatible(target.mealType, version.recipe.mealType)) {
      throw unprocessable(
        `"${version.recipe.title}" is a ${MEAL_NAMES[version.recipe.mealType]} recipe and cannot fill the ${MEAL_NAMES[target.mealType]} slot.`,
        { slot: target.mealType, recipeMealType: version.recipe.mealType },
      );
    }

    const previous = await repository.findAssignment(tx, day.id, target.mealType);

    const assignment = await repository.upsertAssignment(tx, {
      cycleDayId: day.id,
      mealType: target.mealType,
      recipeVersionId: version.id,
      // Servings default to the cycle roster rather than 1, which is what makes
      // demand aggregation meaningful (BR-6).
      servings: input.servings ?? cycle.subscriberCount,
      notes: input.notes,
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "meal.assigned",
      entityType: "MealAssignment",
      entityId: assignment.id,
      before: previous
        ? { recipeVersionId: previous.recipeVersionId, servings: previous.servings }
        : undefined,
      after: {
        cycleId: target.cycleId,
        dayNumber: target.dayNumber,
        mealType: target.mealType,
        recipeVersionId: assignment.recipeVersionId,
        servings: assignment.servings,
      },
      requestId: context.requestId,
    });

    return assignment;
  });
}

export async function clearMeal(target: AssignTarget, context: Context) {
  assertCan(context.actor, "cycles:write");

  return db.$transaction(async (tx) => {
    const day = await repository.findCycleDay(tx, target.cycleId, target.dayNumber);
    if (!day) throw notFound(`Day ${target.dayNumber} of this cycle`);

    const assignment = await repository.findAssignment(tx, day.id, target.mealType);
    if (!assignment) throw notFound(`${MEAL_NAMES[target.mealType]} assignment for day ${target.dayNumber}`);

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "meal.cleared",
      entityType: "MealAssignment",
      entityId: assignment.id,
      before: {
        cycleId: target.cycleId,
        dayNumber: target.dayNumber,
        mealType: target.mealType,
        recipeVersionId: assignment.recipeVersionId,
      },
      requestId: context.requestId,
    });

    await repository.deleteAssignment(tx, assignment.id);
    return { cleared: true, dayNumber: target.dayNumber, mealType: target.mealType };
  });
}
