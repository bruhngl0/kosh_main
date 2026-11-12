import { z } from "zod";
import { importPurchaseOrders } from "@/modules/finance";
import { ok, parseParams, route } from "@/server/http";
import { monthSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ month: monthSchema });

/** BR-21. Safe to call repeatedly — already-imported orders are skipped. */
export const POST = route<{ month: string }>(async ({ params, getActor, requestId }) => {
  const { month } = parseParams(params, paramsSchema);
  return ok(await importPurchaseOrders(month, { actor: await getActor(), requestId }));
});
