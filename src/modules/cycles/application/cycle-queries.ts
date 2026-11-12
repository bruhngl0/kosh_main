import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { toDateString, toNullableNumber, toNumber } from "@/shared/money";
import {
  MEAL_ORDER,
  cycleCovering,
  phaseForWeek,
  weekForDay,
  weekCountFor,
  type MealType,
} from "@/modules/cycles/domain/cycle";
import {
  conflictedDayNumbers,
  findProteinConflicts,
  type ProteinConflict,
} from "@/modules/cycles/domain/protein-rotation";
import * as repository from "@/modules/cycles/infrastructure/cycle-repository";

/** Read models. Queries shape data for a screen; they never mutate. */

export async function listCycles(filter: { status?: string } = {}) {
  const cycles = await repository.listCycles(db, filter);
  return cycles.map((cycle) => ({
    id: cycle.id,
    name: cycle.name,
    cycleNumber: cycle.cycleNumber,
    status: cycle.status,
    durationDays: cycle.durationDays,
    subscriberCount: cycle.subscriberCount,
    weekStart: toDateString(cycle.weekStart),
    chefName: cycle.chefName,
    foodCostTargetPercent: toNullableNumber(cycle.foodCostTargetPercent),
    proteinWindowDays: cycle.proteinWindowDays,
    publishedAt: cycle.publishedAt?.toISOString() ?? null,
    counts: cycle._count,
  }));
}

export type CycleCalendar = Awaited<ReturnType<typeof getCycleCalendar>>;

/** The planner's main read model: days, slots, dates, and conflicts. */
export async function getCycleCalendar(cycleId?: string) {
  const cycle = cycleId
    ? await repository.findCycleById(db, cycleId)
    : await repository.findLatestCycle(db);

  if (!cycle) {
    if (cycleId) throw notFound("Cycle", cycleId);
    return null;
  }

  const days = cycle.days.map((day) => ({
    id: day.id,
    dayNumber: day.dayNumber,
    weekNumber: day.weekNumber,
    phaseLabel: day.phaseLabel,
    date: dateForDay(cycle.weekStart, day.dayNumber),
    meals: Object.fromEntries(
      day.assignments.map((assignment) => [
        assignment.mealType,
        {
          assignmentId: assignment.id,
          mealType: assignment.mealType,
          recipeId: assignment.recipeVersion.recipe.id,
          recipeVersionId: assignment.recipeVersionId,
          title: assignment.recipeVersion.recipe.title,
          subtitle: assignment.recipeVersion.recipe.subtitle,
          protein: assignment.recipeVersion.proteinSource ?? "—",
          kcal: toNullableNumber(assignment.recipeVersion.calories),
          proteinGrams: toNullableNumber(assignment.recipeVersion.proteinGrams),
          servings: assignment.servings,
          advanceCount: assignment.recipeVersion.steps.filter((step) => step.criticality !== "info").length,
        },
      ]),
    ),
  }));

  const conflicts = computeConflicts(cycle, cycle.proteinWindowDays);
  const flagged = conflictedDayNumbers(conflicts);
  const assignedCount = days.reduce((sum, day) => sum + Object.keys(day.meals).length, 0);

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      durationDays: cycle.durationDays,
      subscriberCount: cycle.subscriberCount,
      weekStart: toDateString(cycle.weekStart),
      chefName: cycle.chefName,
      foodCostTargetPercent: toNullableNumber(cycle.foodCostTargetPercent),
      proteinWindowDays: cycle.proteinWindowDays,
      publishedAt: cycle.publishedAt?.toISOString() ?? null,
    },
    days: days.map((day) => ({ ...day, hasConflict: flagged.has(day.dayNumber) })),
    conflicts,
    stats: {
      weekCount: weekCountFor(cycle.durationDays),
      daysPlanned: days.length,
      slotsTotal: days.length * MEAL_ORDER.length,
      slotsAssigned: assignedCount,
      slotsMissing: days.length * MEAL_ORDER.length - assignedCount,
      conflictCount: conflicts.length,
    },
  };
}

export async function getConflicts(cycleId: string, windowDays?: number) {
  const cycle = await repository.findCycleMeta(db, cycleId);
  if (!cycle) throw notFound("Cycle", cycleId);

  const days = await repository.findDinnerProteins(db, cycleId);
  const conflicts = findProteinConflicts(
    days.map((day) => ({
      dayNumber: day.dayNumber,
      protein: day.assignments[0]?.recipeVersion.proteinSource ?? null,
    })),
    windowDays ?? cycle.proteinWindowDays,
  );

  const titles = new Map(
    days.map((day) => [day.dayNumber, day.assignments[0]?.recipeVersion.recipe.title ?? null]),
  );

  return {
    windowDays: windowDays ?? cycle.proteinWindowDays,
    conflicts: conflicts.map((conflict) => ({
      ...conflict,
      dishTitle: titles.get(conflict.dayNumber) ?? null,
      previousDishTitle: titles.get(conflict.previousDayNumber) ?? null,
    })),
  };
}

/** Weekly production list — the sheet the kitchen prints (§2.2). */
export async function getProductionPlan(cycleId: string, weekNumber: number) {
  const cycle = await repository.findCycleMeta(db, cycleId);
  if (!cycle) throw notFound("Cycle", cycleId);

  const days = await repository.findDaysForWeek(db, cycleId, weekNumber);

  const rows = days.map((day) => ({
    dayNumber: day.dayNumber,
    date: dateForDay(cycle.weekStart, day.dayNumber),
    phaseLabel: day.phaseLabel,
    meals: MEAL_ORDER.map((mealType) => {
      const assignment = day.assignments.find((item) => item.mealType === mealType);
      if (!assignment) return { mealType, assigned: false as const };
      const advance = assignment.recipeVersion.steps.filter((step) => step.criticality !== "info");
      return {
        mealType,
        assigned: true as const,
        title: assignment.recipeVersion.recipe.title,
        subtitle: assignment.recipeVersion.recipe.subtitle,
        protein: assignment.recipeVersion.proteinSource ?? "—",
        kcal: toNullableNumber(assignment.recipeVersion.calories),
        proteinGrams: toNullableNumber(assignment.recipeVersion.proteinGrams),
        servings: assignment.servings,
        advance: advance.map((step) => step.instructions),
      };
    }),
  }));

  const advanceCount = rows.reduce(
    (sum, day) => sum + day.meals.reduce((inner, meal) => inner + (meal.assigned ? meal.advance.length : 0), 0),
    0,
  );

  return {
    weekNumber,
    phaseLabel: phaseForWeek(weekNumber),
    productionDays: rows.length,
    totalDishes: rows.reduce((sum, day) => sum + day.meals.filter((meal) => meal.assigned).length, 0),
    advanceItems: advanceCount,
    // The rotation strip the prototype printed above the production list.
    dinnerRotation: rows.map((day) => ({
      dayNumber: day.dayNumber,
      protein: day.meals.find((meal) => meal.mealType === "DI" && meal.assigned)?.protein ?? "—",
    })),
    days: rows,
  };
}

/**
 * Published cross-module query (§4.3). Procurement calls this rather than
 * reaching into cycle tables itself.
 */
export async function getWeekDemandInputs(cycleId: string, weekNumber: number) {
  const assignments = await repository.findWeekIngredientDemand(db, cycleId, weekNumber);
  return assignments.flatMap((assignment) =>
    assignment.recipeVersion.ingredients.map((item) => ({
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient.name,
      quantity: toNumber(item.quantity),
      unit: item.unit,
      servings: assignment.servings,
    })),
  );
}

export async function getDayDemandInputs(cycleDayId: string, meals?: MealType[]) {
  const assignments = await repository.findDayIngredientDemand(db, cycleDayId, meals);
  return assignments.flatMap((assignment) =>
    assignment.recipeVersion.ingredients.map((item) => ({
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient.name,
      quantity: toNumber(item.quantity),
      unit: item.unit,
      servings: assignment.servings,
    })),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeConflicts(
  cycle: repository.CycleWithDays,
  windowDays: number,
): ProteinConflict[] {
  return findProteinConflicts(
    cycle.days.map((day) => ({
      dayNumber: day.dayNumber,
      protein: day.assignments.find((assignment) => assignment.mealType === "DI")?.recipeVersion.proteinSource ?? null,
    })),
    windowDays,
  );
}

/** Day 1 is the start date itself. Dates are UTC to match `@db.Date`. */
function dateForDay(weekStart: Date | null, dayNumber: number): string | null {
  if (!weekStart) return null;
  const date = new Date(weekStart);
  date.setUTCDate(date.getUTCDate() + (dayNumber - 1));
  return date.toISOString().slice(0, 10);
}

export type DayMenu = NonNullable<Awaited<ReturnType<typeof getMenuForDate>>>;

/**
 * BR-26 — what the kitchen cooks on a calendar date. Published for the run
 * sheet. Null when no cycle covers the date.
 */
export async function getMenuForDate(date: string) {
  const cycles = await repository.findCyclesStartedBy(db, new Date(`${date}T00:00:00Z`));
  const covering = cycleCovering(cycles, date);
  if (!covering) return null;

  const { cycle, dayNumber } = covering;
  const day = await repository.findDayMenu(db, cycle.id, dayNumber);
  const meals = MEAL_ORDER.flatMap((mealType) => {
    const assignment = day?.assignments.find((a) => a.mealType === mealType);
    if (!assignment) return [];
    const version = assignment.recipeVersion;
    return [
      {
        mealType,
        title: version.recipe.title,
        subtitle: version.recipe.subtitle,
        protein: version.proteinSource,
        kcal: toNullableNumber(version.calories),
        proteinGrams: toNullableNumber(version.proteinGrams),
        carbsGrams: toNullableNumber(version.carbsGrams),
        fatGrams: toNullableNumber(version.fatGrams),
        allergens: version.allergens.map((a) => a.allergenCode),
        platingNotes: version.platingNotes,
        servings: assignment.servings,
        notes: assignment.notes,
      },
    ];
  });

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      durationDays: cycle.durationDays,
      chefName: cycle.chefName,
      subscriberCount: cycle.subscriberCount,
    },
    dayNumber,
    weekNumber: day?.weekNumber ?? weekForDay(dayNumber),
    phaseLabel: day?.phaseLabel ?? null,
    meals,
  };
}

/** The nearest dates any cycle covers, for pointing an empty run sheet somewhere useful. */
export async function getCycleDateRanges() {
  const cycles = await repository.listCycles(db);
  return cycles
    .filter((cycle) => cycle.weekStart && cycle.status !== "ARCHIVED")
    .map((cycle) => {
      const end = new Date(cycle.weekStart!);
      end.setUTCDate(end.getUTCDate() + cycle.durationDays - 1);
      return { name: cycle.name, status: cycle.status, from: toDateString(cycle.weekStart)!, to: toDateString(end)! };
    });
}
