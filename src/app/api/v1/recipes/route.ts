import { createRecipe, listRecipes } from "@/modules/recipes";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createRecipeSchema, recipeQuerySchema } from "@/shared/schemas/recipe";

export const GET = route(async ({ url }) => {
  const filter = parseQuery(url, recipeQuerySchema);
  return ok(await listRecipes(filter));
});

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createRecipeSchema);
  const recipe = await createRecipe(input, { actor: await getActor(), requestId });
  return created(recipe);
});
