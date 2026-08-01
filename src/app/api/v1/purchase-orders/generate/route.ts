import { generatePurchaseOrders } from "@/modules/procurement";
import { ok, parseBody, route } from "@/server/http";
import { generatePurchaseOrderSchema } from "@/shared/schemas/procurement";

/**
 * BR-6, BR-7, BR-16.
 *
 * The response carries three things the previous version silently swallowed:
 * `unsourced` (demanded, but no preferred vendor), `exceptions` (quantities we
 * refused to guess a unit conversion for), and `skipped` (orders already sent
 * to a vendor, which regeneration must not rewrite).
 */
export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, generatePurchaseOrderSchema);
  const result = await generatePurchaseOrders(input, { actor: await getActor(), requestId });
  return ok(result, { idempotent: true });
});
