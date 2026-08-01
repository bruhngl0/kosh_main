export type RecipeVersionView = {
  id: string;
  versionNumber: number;
  status: string;
  editable: boolean;
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  proteinSource: string | null;
  platingNotes: string | null;
  publishedAt: string | null;
  ingredients: { id: string; ingredientId: string; name: string; quantity: number; unit: string; note: string | null }[];
  steps: {
    id: string;
    stepNumber: number;
    title: string;
    instructions: string;
    temperatureC: number | null;
    durationMinutes: number | null;
    criticality: string;
  }[];
  advance: string[];
  allergens: string[];
};

export type RecipeListItem = {
  id: string;
  title: string;
  subtitle: string | null;
  mealType: string;
  active: boolean;
  latestVersion: RecipeVersionView;
};

export const MEAL_LABELS: Record<string, string> = {
  BF: "Breakfast",
  SN: "Snack",
  LU: "Lunch",
  DI: "Dinner",
};
