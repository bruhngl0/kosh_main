import { z } from "zod";
import { getProductionPlan } from "@/modules/cycles";
import { ok, parseParams, parseQuery, route, uuidParam } from "@/server/http";
import { productionQuerySchema } from "@/shared/schemas/cycle";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params, url }) => {
  const { id } = parseParams(params, paramsSchema);
  const { week } = parseQuery(url, productionQuerySchema);
  return ok(await getProductionPlan(id, week));
});
