import { z } from "zod";
import { postRecurringCost } from "@/modules/finance";
import { created, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { postRecurringCostSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ id: uuidParam });

/** BR-22. Logs the fixed cost as paid for one month; refuses a second posting. */
export const POST = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, postRecurringCostSchema);
  return created(await postRecurringCost(id, input, { actor: await getActor(), requestId }));
});
