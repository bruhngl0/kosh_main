import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/db";

/**
 * Cycle persistence. The ONLY place cycle tables are queried.
 * See docs/system-design.md §4.1 — repositories never open transactions; use
 * cases own the boundary and pass their handle in.
 */

/** Assignments with everything the planner, conflicts, and prep need. */
const assignmentInclude = {
  recipeVersion: {
    include: {
      recipe: { select: { id: true, title: true, subtitle: true, mealType: true, active: true } },
      steps: { orderBy: { stepNumber: "asc" } },
    },
  },
} satisfies Prisma.MealAssignmentInclude;

const cycleWithDaysInclude = {
  days: {
    orderBy: { dayNumber: "asc" },
    include: { assignments: { include: assignmentInclude } },
  },
} satisfies Prisma.CycleInclude;

export type CycleWithDays = Prisma.CycleGetPayload<{ include: typeof cycleWithDaysInclude }>;

export function listCycles(client: DbClient, filter: { status?: Prisma.EnumCycleStatusFilter | string } = {}) {
  return client.cycle.findMany({
    where: filter.status ? { status: filter.status as never } : undefined,
    orderBy: { cycleNumber: "desc" },
    include: { _count: { select: { days: true, prepTasks: true, purchaseOrders: true } } },
  });
}

export function findCycleById(client: DbClient, id: string) {
  return client.cycle.findUnique({ where: { id }, include: cycleWithDaysInclude });
}

export function findCycleMeta(client: DbClient, id: string) {
  return client.cycle.findUnique({ where: { id } });
}

/** Most recent cycle, used as the default view when none is selected. */
export function findLatestCycle(client: DbClient) {
  return client.cycle.findFirst({ orderBy: { cycleNumber: "desc" }, include: cycleWithDaysInclude });
}

export function findCycleByNumber(client: DbClient, cycleNumber: number) {
  return client.cycle.findUnique({ where: { cycleNumber }, select: { id: true, name: true } });
}

export function createCycleWithDays(
  client: DbClient,
  data: Prisma.CycleCreateInput & { days: { create: { dayNumber: number; weekNumber: number; phaseLabel: string }[] } },
) {
  return client.cycle.create({ data, include: { days: { orderBy: { dayNumber: "asc" } } } });
}

export function updateCycle(client: DbClient, id: string, data: Prisma.CycleUpdateInput) {
  return client.cycle.update({ where: { id }, data });
}

export function deleteCycle(client: DbClient, id: string) {
  // cycle_days cascade, and meal_assignments and prep_tasks cascade from those.
  return client.cycle.delete({ where: { id } });
}

/** Just enough to run BR-4 without loading every step and ingredient. */
export function findPublishSummary(client: DbClient, id: string) {
  return client.cycle.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      name: true,
      days: {
        orderBy: { dayNumber: "asc" },
        select: {
          dayNumber: true,
          assignments: {
            select: {
              mealType: true,
              recipeVersion: { select: { status: true, recipe: { select: { active: true } } } },
            },
          },
        },
      },
    },
  });
}

/** Dinner protein per day, for BR-1. */
export function findDinnerProteins(client: DbClient, cycleId: string) {
  return client.cycleDay.findMany({
    where: { cycleId },
    orderBy: { dayNumber: "asc" },
    select: {
      dayNumber: true,
      assignments: {
        where: { mealType: "DI" },
        select: { recipeVersion: { select: { proteinSource: true, recipe: { select: { title: true } } } } },
      },
    },
  });
}

export function findCycleDay(client: DbClient, cycleId: string, dayNumber: number) {
  return client.cycleDay.findUnique({
    where: { cycleId_dayNumber: { cycleId, dayNumber } },
    select: { id: true, dayNumber: true, weekNumber: true },
  });
}

export function findDaysForWeek(client: DbClient, cycleId: string, weekNumber: number) {
  return client.cycleDay.findMany({
    where: { cycleId, weekNumber },
    orderBy: { dayNumber: "asc" },
    include: { assignments: { include: assignmentInclude } },
  });
}

export function upsertAssignment(
  client: DbClient,
  input: { cycleDayId: string; mealType: Prisma.MealAssignmentCreateInput["mealType"]; recipeVersionId: string; servings: number; notes?: string },
) {
  const { cycleDayId, mealType, recipeVersionId, servings, notes } = input;
  return client.mealAssignment.upsert({
    where: { cycleDayId_mealType: { cycleDayId, mealType } },
    update: { recipeVersionId, servings, notes },
    create: { cycleDayId, mealType, recipeVersionId, servings, notes },
    include: assignmentInclude,
  });
}

export function findAssignment(client: DbClient, cycleDayId: string, mealType: string) {
  return client.mealAssignment.findUnique({
    where: { cycleDayId_mealType: { cycleDayId, mealType: mealType as never } },
    include: assignmentInclude,
  });
}

export function deleteAssignment(client: DbClient, id: string) {
  return client.mealAssignment.delete({ where: { id } });
}

/** Assignments with ingredient lines — the input to demand aggregation (BR-6). */
export function findWeekIngredientDemand(client: DbClient, cycleId: string, weekNumber: number) {
  return client.mealAssignment.findMany({
    where: { cycleDay: { cycleId, weekNumber } },
    select: {
      servings: true,
      mealType: true,
      cycleDay: { select: { dayNumber: true } },
      recipeVersion: {
        select: {
          id: true,
          ingredients: {
            select: {
              ingredientId: true,
              quantity: true,
              unit: true,
              ingredient: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

/** Same shape, scoped to one day — the input to production consumption (BR-14). */
export function findDayIngredientDemand(client: DbClient, cycleDayId: string, meals?: string[]) {
  return client.mealAssignment.findMany({
    where: {
      cycleDayId,
      ...(meals?.length ? { mealType: { in: meals as never[] } } : {}),
    },
    select: {
      servings: true,
      mealType: true,
      recipeVersion: {
        select: {
          ingredients: {
            select: {
              ingredientId: true,
              quantity: true,
              unit: true,
              ingredient: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}
