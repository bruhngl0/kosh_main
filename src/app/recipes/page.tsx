import { AppShell } from "@/components/app-shell";
import { RecipeDatabase } from "@/components/recipes/recipe-database";
import { listRecipes } from "@/modules/recipes";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const recipes = await listRecipes();
  return (
    <AppShell>
      <RecipeDatabase recipes={recipes} />
    </AppShell>
  );
}
