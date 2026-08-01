import { z } from "zod";
import { getRecipeVersion, updateRecipeVersion } from "@/modules/recipes";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateRecipeVersionSchema } from "@/shared/schemas/recipe";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getRecipeVersion(id));
});

/** BR-15 — drafts only; editing a published version is a 422. */
export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateRecipeVersionSchema);
  return ok(await updateRecipeVersion(id, input, { actor: await getActor(), requestId }));
});
