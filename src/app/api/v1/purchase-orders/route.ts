import { createPurchaseOrder, listPurchaseOrders } from "@/modules/procurement";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createPurchaseOrderSchema, purchaseOrderQuerySchema } from "@/shared/schemas/procurement";

export const GET = route(async ({ url }) => {
  const filter = parseQuery(url, purchaseOrderQuerySchema);
  return ok(await listPurchaseOrders(filter));
});

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createPurchaseOrderSchema);
  return created(await createPurchaseOrder(input, { actor: await getActor(), requestId }));
});
