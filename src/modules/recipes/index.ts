/** Recipes module — public surface. See docs/system-design.md §4.3. */

export {
  createRecipe,
  updateRecipe,
  archiveRecipe,
  createRecipeVersion,
  updateRecipeVersion,
  publishRecipeVersion,
} from "@/modules/recipes/application/recipe-management";

export {
  listRecipes,
  getRecipe,
  getRecipeVersion,
  // Cross-module query interface, consumed by the cycle planner.
  listAssignableVersions,
  type RecipeVersionView,
} from "@/modules/recipes/application/recipe-queries";
