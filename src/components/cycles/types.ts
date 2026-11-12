/** View types for the planner, mirroring the cycle API read models. */

export type MealType = "BF" | "SN" | "LU" | "DI";

export const MEAL_ORDER: MealType[] = ["BF", "SN", "LU", "DI"];
export const MEAL_NAMES: Record<MealType, string> = {
  BF: "Breakfast",
  SN: "Snack",
  LU: "Lunch",
  DI: "Dinner",
};

export type MealSlot = {
  assignmentId: string;
  mealType: MealType;
  recipeId: string;
  recipeVersionId: string;
  title: string;
  subtitle: string | null;
  protein: string;
  kcal: number | null;
  proteinGrams: number | null;
  servings: number;
  /** Set by hand; the roster sync leaves it alone (BR-30). */
  servingsLocked: boolean;
  advanceCount: number;
};

export type CycleDay = {
  id: string;
  dayNumber: number;
  weekNumber: number;
  phaseLabel: string;
  date: string | null;
  hasConflict: boolean;
  meals: Partial<Record<MealType, MealSlot>>;
};

export type Conflict = {
  dayNumber: number;
  previousDayNumber: number;
  protein: string;
  gapDays: number;
  suggestedSwap: string;
  dishTitle?: string | null;
  previousDishTitle?: string | null;
};

export type CycleSummary = {
  id: string;
  name: string;
  cycleNumber: number;
  status: string;
  durationDays: number;
  subscriberCount: number;
  headcountSyncedAt: string | null;
  weekStart: string | null;
  chefName: string | null;
  foodCostTargetPercent: number | null;
  proteinWindowDays: number;
  publishedAt: string | null;
};

export type CycleStats = {
  weekCount: number;
  daysPlanned: number;
  slotsTotal: number;
  slotsAssigned: number;
  slotsMissing: number;
  conflictCount: number;
};

export type PrepTask = {
  id: string;
  text: string;
  taskType: string;
  leadLabel: string;
  dueDate: string | null;
  urgent: boolean;
  status: string;
  dayNumber: number;
  weekNumber: number;
  mealType: MealType | null;
  dishTitle: string | null;
  completedBy: string | null;
};

export type RecipeOption = {
  recipeVersionId: string;
  recipeId: string;
  title: string;
  subtitle: string | null;
  mealType: MealType;
  versionNumber: number;
  proteinSource: string | null;
  calories: number | null;
  proteinGrams: number | null;
};

export type ProductionPlan = {
  weekNumber: number;
  phaseLabel: string;
  productionDays: number;
  totalDishes: number;
  advanceItems: number;
  dinnerRotation: { dayNumber: number; protein: string }[];
  days: {
    dayNumber: number;
    date: string | null;
    phaseLabel: string;
    meals: (
      | { mealType: MealType; assigned: false }
      | {
          mealType: MealType;
          assigned: true;
          title: string;
          subtitle: string | null;
          protein: string;
          kcal: number | null;
          proteinGrams: number | null;
          servings: number;
          advance: string[];
        }
    )[];
  }[];
};
