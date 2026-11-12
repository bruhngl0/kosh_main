import { assertReasonableDate, setCheck } from "@/modules/runsheet";
import { kitchenDate } from "@/modules/finance";
import { ok, parseBody, parseParams, route } from "@/server/http";
import { runSheetDateParams, setCheckSchema } from "@/shared/schemas/run-sheet";

/** BR-27 — `{ taskKey, done }` ticks or unticks one task; `{ all: true }` ticks every task. */
export const PUT = route<{ date: string }>(async ({ params, request, getActor, requestId }) => {
  const { date } = parseParams(params, runSheetDateParams);
  assertReasonableDate(date, kitchenDate(new Date()));
  const input = await parseBody(request, setCheckSchema);
  return ok(await setCheck(date, input, { actor: await getActor(), requestId }));
});
