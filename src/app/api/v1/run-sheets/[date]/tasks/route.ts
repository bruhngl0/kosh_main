import { addRunSheetTask, assertReasonableDate } from "@/modules/runsheet";
import { kitchenDate } from "@/modules/finance";
import { created, parseBody, parseParams, route } from "@/server/http";
import { addRunSheetTaskSchema, runSheetDateParams } from "@/shared/schemas/run-sheet";

/** Adds a one-off task to this day's checklist. */
export const POST = route<{ date: string }>(async ({ params, request, getActor, requestId }) => {
  const { date } = parseParams(params, runSheetDateParams);
  assertReasonableDate(date, kitchenDate(new Date()));
  const input = await parseBody(request, addRunSheetTaskSchema);
  return created(await addRunSheetTask(date, input, { actor: await getActor(), requestId }));
});
