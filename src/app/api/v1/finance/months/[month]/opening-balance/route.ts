import { z } from "zod";
import { setOpeningBalance } from "@/modules/finance";
import { ok, parseBody, parseParams, route } from "@/server/http";
import { monthSchema, openingBalanceSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ month: monthSchema });

/** BR-20. `{ amount: null }` clears the hand-set figure and resumes carry-forward. */
export const PUT = route<{ month: string }>(async ({ params, request, getActor, requestId }) => {
  const { month } = parseParams(params, paramsSchema);
  const { amount } = await parseBody(request, openingBalanceSchema);
  return ok(await setOpeningBalance(month, amount, { actor: await getActor(), requestId }));
});
