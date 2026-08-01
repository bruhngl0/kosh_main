import { z } from "zod";
import { receivePurchaseOrder } from "@/modules/procurement";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { receivePurchaseOrderSchema } from "@/shared/schemas/procurement";

const paramsSchema = z.object({ id: uuidParam });

/**
 * BR-13 — the bridge between procurement and inventory.
 *
 * Line quantities, the RECEIVE movements, and the order status all change in
 * one transaction. Previously marking an order received updated a timestamp
 * and stock never moved at all.
 */
export const POST = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, receivePurchaseOrderSchema);
  return ok(await receivePurchaseOrder(id, input, { actor: await getActor(), requestId }));
});
