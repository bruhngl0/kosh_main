import { z } from "zod";
import { publishRecipeVersion } from "@/modules/recipes";
import { ok, parseParams, route, uuidParam } from "@/server/http";

const paramsSchema = z.object({ id: uuidParam });

/**
 * Without this, a recipe created through the UI stayed DRAFT forever while
 * every reader filtered for PUBLISHED — so it could never be put on a menu.
 */
export const POST = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await publishRecipeVersion(id, { actor: await getActor(), requestId }));
});
