import { z } from "zod";
import { syncCycleHeadcount } from "@/modules/cycles";
import { ok, parseParams, route, uuidParam } from "@/server/http";

const paramsSchema = z.object({ id: uuidParam });

/**
 * BR-30 — brings the cycle's servings in line with the subscriber roster now.
 * Roster changes already do this on their own; this is for the planner's
 * "Sync from roster" button and for checking.
 */
export const POST = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await syncCycleHeadcount(id, { actor: await getActor(), requestId }));
});
