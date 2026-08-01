import { getCostSummary } from "@/modules/procurement";
import { ok, parseQuery, route } from "@/server/http";
import { costSummaryQuerySchema } from "@/shared/schemas/procurement";

/**
 * BR-17 — food cost and P&L.
 *
 * With `cycleId` and `weekNumber` this prices real weekly demand; without them
 * it falls back to the prototype's standing `Qty Needed` × unit cost view.
 */
export const GET = route(async ({ url }) => {
  const query = parseQuery(url, costSummaryQuerySchema);
  return ok(await getCostSummary(query));
});
