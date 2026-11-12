import { createCashTransaction } from "@/modules/finance";
import { created, parseBody, route } from "@/server/http";
import { createCashTransactionSchema } from "@/shared/schemas/finance";

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createCashTransactionSchema);
  return created(await createCashTransaction(input, { actor: await getActor(), requestId }));
});
