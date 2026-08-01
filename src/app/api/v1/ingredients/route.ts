import { createIngredient, listIngredients } from "@/modules/inventory";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createIngredientSchema, ingredientQuerySchema } from "@/shared/schemas/inventory";

export const GET = route(async ({ url }) => {
  const filter = parseQuery(url, ingredientQuerySchema);
  return ok(await listIngredients(filter));
});

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createIngredientSchema);
  const ingredient = await createIngredient(input, { actor: await getActor(), requestId });
  return created(ingredient);
});
