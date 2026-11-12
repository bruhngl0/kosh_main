import { z } from "zod";
import { deleteCashTransaction, updateCashTransaction } from "@/modules/finance";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { updateCashTransactionSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ id: uuidParam });

export const PATCH = route<{ id: string }>(async ({ params, request, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  const input = await parseBody(request, updateCashTransactionSchema);
  return ok(await updateCashTransaction(id, input, { actor: await getActor(), requestId }));
});

export const DELETE = route<{ id: string }>(async ({ params, getActor, requestId }) => {
  const { id } = parseParams(params, paramsSchema);
  return ok(await deleteCashTransaction(id, { actor: await getActor(), requestId }));
});
