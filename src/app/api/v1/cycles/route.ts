import { createCycle, listCycles } from "@/modules/cycles";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createCycleSchema, cycleQuerySchema } from "@/shared/schemas/cycle";

export const GET = route(async ({ url }) => {
  const query = parseQuery(url, cycleQuerySchema);
  return ok(await listCycles(query));
});

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createCycleSchema);
  const cycle = await createCycle(input, { actor: await getActor(), requestId });
  return created(cycle);
});
