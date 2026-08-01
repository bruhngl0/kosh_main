import { z } from "zod";
import { archiveRecipe, getRecipe, updateRecipe } from "@/modules/recipes";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateRecipeSchema } from "@/shared/schemas/recipe";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getRecipe(id));
});

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateRecipeSchema);
  return ok(await updateRecipe(id, input, { actor: await getActor(), requestId }));
});

export const DELETE = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await archiveRecipe(id, { actor: await getActor(), requestId }));
});
