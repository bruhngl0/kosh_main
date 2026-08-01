import { z } from "zod";
import { createVendor, listVendors } from "@/modules/vendors";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createVendorSchema } from "@/shared/schemas/procurement";

const querySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const GET = route(async ({ url }) => ok(await listVendors(parseQuery(url, querySchema))));

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createVendorSchema);
  return created(await createVendor(input, { actor: await getActor(), requestId }));
});
