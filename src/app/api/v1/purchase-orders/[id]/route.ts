import { z } from "zod";
import { getPurchaseOrder, transitionPurchaseOrder } from "@/modules/procurement";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { transitionPurchaseOrderSchema } from "@/shared/schemas/procurement";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getPurchaseOrder(id));
});

/**
 * BR-12 — validated against the state machine. Moving to RECEIVED is rejected
 * here and directed to /receive, so stock movements are always written.
 */
export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, transitionPurchaseOrderSchema);
  return ok(await transitionPurchaseOrder(id, input, { actor: await getActor(), requestId }));
});
