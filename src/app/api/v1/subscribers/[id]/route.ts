import { z } from "zod";
import { getSubscriber, updateSubscriber } from "@/modules/subscribers";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateSubscriberSchema } from "@/shared/schemas/subscribers";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getSubscriber(id));
});

/** Subscribers are never deleted — vessel kits and history point at them. Set status "ended". */
export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateSubscriberSchema);
  return ok(await updateSubscriber(id, input, { actor: await getActor(), requestId }));
});
