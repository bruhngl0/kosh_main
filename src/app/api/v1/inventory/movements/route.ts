import { listMovements, recordMovement } from "@/modules/inventory";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { inventoryMovementSchema, movementQuerySchema } from "@/shared/schemas/inventory";

export const GET = route(async ({ url }) => {
  const filter = parseQuery(url, movementQuerySchema);
  return ok(await listMovements(filter));
});

/**
 * BR-9, BR-10, BR-11 — the only way stock changes.
 * The caller supplies a magnitude and a type; the sign is derived server-side.
 */
export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, inventoryMovementSchema);
  const movement = await recordMovement(input, { actor: await getActor(), requestId });
  return created(movement);
});
