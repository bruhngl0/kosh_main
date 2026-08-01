import { z } from "zod";
import { updateVesselKit } from "@/modules/vessels";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateVesselKitSchema } from "@/shared/schemas/inventory";

const paramsSchema = z.object({ id: uuidParam });

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateVesselKitSchema);
  return ok(await updateVesselKit(id, input, { actor: await getActor(), requestId }));
});
