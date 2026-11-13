import { z } from "zod";
import { closeCycle } from "@/modules/cycles";
import { ok, parseParams, route, uuidParam } from "@/server/http";

const paramsSchema = z.object({ id: uuidParam });

/** ACTIVE → CLOSED. Anything else is a 422 naming the current status. */
export const POST = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await closeCycle(id, { actor: await getActor(), requestId }));
});
