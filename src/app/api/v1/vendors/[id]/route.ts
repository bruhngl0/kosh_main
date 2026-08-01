import { z } from "zod";
import { getVendor, updateVendor } from "@/modules/vendors";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateVendorSchema } from "@/shared/schemas/procurement";

const paramsSchema = z.object({ id: uuidParam });

export const GET = route<{ id: string }>(async ({ params }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await getVendor(id));
});

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateVendorSchema);
  return ok(await updateVendor(id, input, { actor: await getActor(), requestId }));
});

/** Vendors are deactivated, never deleted — purchase history references them. */
export const DELETE = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await updateVendor(id, { active: false }, { actor: await getActor(), requestId }));
});
