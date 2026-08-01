import { z } from "zod";
import { archiveIngredient, getIngredient, updateIngredient } from "@/modules/inventory";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateIngredientSchema } from "@/shared/schemas/inventory";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getIngredient(id));
});

/**
 * Note the absence of stock quantity: BR-11 means a balance changes only
 * through a movement, so adjusting stock goes to /inventory/movements.
 */
export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateIngredientSchema);
  return ok(await updateIngredient(id, input, { actor: await getActor(), requestId }));
});

export const DELETE = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await archiveIngredient(id, { actor: await getActor(), requestId }));
});
