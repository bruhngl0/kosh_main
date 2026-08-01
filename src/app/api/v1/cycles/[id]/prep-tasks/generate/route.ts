import { z } from "zod";
import { generatePrepTasks } from "@/modules/production";
import { ok, parseParams, route, uuidParam } from "@/server/http";

const paramsSchema = z.object({ id: uuidParam });

/**
 * BR-3, BR-16. Idempotent: reconciles on (cycleId, sourceKey), so completed
 * tasks keep their status and re-running creates no duplicates.
 */
export const POST = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const result = await generatePrepTasks(id, { actor: await getActor(), requestId });
  return ok(result, { idempotent: true });
});
