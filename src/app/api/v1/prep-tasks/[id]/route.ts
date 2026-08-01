import { z } from "zod";
import { updatePrepTask } from "@/modules/production";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { prepTaskUpdateSchema } from "@/shared/schemas/cycle";

const paramsSchema = z.object({ id: uuidParam });

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const { status } = await parseBody(request, prepTaskUpdateSchema);
  return ok(await updatePrepTask(id, status, { actor: await getActor(), requestId }));
});
