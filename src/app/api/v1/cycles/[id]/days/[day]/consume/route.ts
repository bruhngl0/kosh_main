import { z } from "zod";
import { consumeProduction } from "@/modules/production";
import { intParam, ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { consumeProductionSchema } from "@/shared/schemas/cycle";

const paramsSchema = z.object({ id: uuidParam, day: intParam("Day") });

/** BR-14 — records what a production run consumed, subject to BR-10. */
export const POST = route<{ id: string; day: string }>(async ({ params, request, getActor, requestId }) => {
  const { id, day } = parseParams(params, paramsSchema);
  const input = await parseBody(request, consumeProductionSchema);
  return ok(
    await consumeProduction({ cycleId: id, dayNumber: day }, input, {
      actor: await getActor(),
      requestId,
    }),
  );
});
