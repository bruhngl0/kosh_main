import { z } from "zod";
import { createRecipeVersion } from "@/modules/recipes";
import { created, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { createRecipeVersionSchema } from "@/shared/schemas/recipe";

const paramsSchema = z.object({ id: uuidParam });

/** BR-15 — edits to a published recipe happen by creating a new version. */
export const POST = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, createRecipeVersionSchema);
  const version = await createRecipeVersion(id, input, { actor: await getActor(), requestId });
  return created(version);
});
