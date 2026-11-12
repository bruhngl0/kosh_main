import { assertReasonableDate, getRunSheet, updateRunSheet } from "@/modules/runsheet";
import { kitchenDate } from "@/modules/finance";
import { ok, parseBody, parseParams, route } from "@/server/http";
import { runSheetDateParams, updateRunSheetSchema } from "@/shared/schemas/run-sheet";

/** BR-26 — the day's run sheet. Derived on read; nothing is created by viewing it. */
export const GET = route<{ date: string }>(async ({ params }) => {
  const { date } = parseParams(params, runSheetDateParams);
  return ok(await getRunSheet(date));
});

/** Chef, dispatch window, special notes, kitchen notes. */
export const PATCH = route<{ date: string }>(async ({ params, request, getActor, requestId }) => {
  const { date } = parseParams(params, runSheetDateParams);
  assertReasonableDate(date, kitchenDate(new Date()));
  const input = await parseBody(request, updateRunSheetSchema);
  return ok(await updateRunSheet(date, input, { actor: await getActor(), requestId }));
});
