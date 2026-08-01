import { z } from "zod";
import { publishCycle } from "@/modules/cycles";
import { ok, parseParams, route, uuidParam } from "@/server/http";

const paramsSchema = z.object({ id: uuidParam });

/**
 * BR-4. Failure is a 422 carrying the offending days — the previous version
 * returned HTTP 200 with `{ published: false }`, which no client could treat
 * as an error.
 */
export const POST = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await publishCycle(id, { actor: await getActor(), requestId }), { published: true });
});
