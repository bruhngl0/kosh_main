import { z } from "zod";
import { getOutreach } from "@/modules/procurement";
import { ok, parseParams, route, uuidParam } from "@/server/http";

const paramsSchema = z.object({ id: uuidParam });

/** Read-only projection: the full vendor message plus a wa.me deep link. */
export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getOutreach(id));
});
