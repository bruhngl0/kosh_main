import { z } from "zod";
import { listPrepTasks } from "@/modules/production";
import { ok, parseParams, parseQuery, route, uuidParam } from "@/server/http";
import { prepTaskQuerySchema } from "@/shared/schemas/cycle";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params, url }) => {
  const { id } = parseParams(params, paramsSchema);
  const filter = parseQuery(url, prepTaskQuerySchema);
  return ok(await listPrepTasks(id, filter));
});
