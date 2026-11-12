import { createRecurringCost, listRecurringCosts } from "@/modules/finance";
import { created, ok, parseBody, route } from "@/server/http";
import { createRecurringCostSchema } from "@/shared/schemas/finance";

export const GET = route(async () => ok(await listRecurringCosts()));

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createRecurringCostSchema);
  return created(await createRecurringCost(input, { actor: await getActor(), requestId }));
});
