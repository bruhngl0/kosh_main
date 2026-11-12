import { z } from "zod";
import { updateRecurringCost } from "@/modules/finance";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateRecurringCostSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ id: uuidParam });

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateRecurringCostSchema);
  return ok(await updateRecurringCost(id, input, { actor: await getActor(), requestId }));
});

/** Fixed costs are deactivated, not deleted — past postings still point at them. */
export const DELETE = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await updateRecurringCost(id, { active: false }, { actor: await getActor(), requestId }));
});
