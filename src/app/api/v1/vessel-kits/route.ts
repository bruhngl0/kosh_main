import { z } from "zod";
import { createVesselKit, listVesselKits } from "@/modules/vessels";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createVesselKitSchema } from "@/shared/schemas/inventory";

const querySchema = z.object({
  status: z.enum(["active", "needs-replace", "retired"]).optional(),
});

export const GET = route(async ({ url }) => ok(await listVesselKits(parseQuery(url, querySchema))));

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createVesselKitSchema);
  return created(await createVesselKit(input, { actor: await getActor(), requestId }));
});
