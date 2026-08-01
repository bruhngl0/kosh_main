import { z } from "zod";
import { deleteCycle, getCycleCalendar, updateCycle } from "@/modules/cycles";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateCycleSchema } from "@/shared/schemas/cycle";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getCycleCalendar(id));
});

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateCycleSchema);
  return ok(await updateCycle(id, input, { actor: await getActor(), requestId }));
});

export const DELETE = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await deleteCycle(id, { actor: await getActor(), requestId }));
});
