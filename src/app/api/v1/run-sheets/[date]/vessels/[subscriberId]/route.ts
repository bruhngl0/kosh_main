import { assertReasonableDate, setVesselState } from "@/modules/runsheet";
import { kitchenDate } from "@/modules/finance";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { runSheetDateParams, setVesselSchema } from "@/shared/schemas/run-sheet";

const paramsSchema = runSheetDateParams.extend({ subscriberId: uuidParam });

/** BR-28 — `{ status: "out" | "collected" | "missing" | null }`. */
export const PUT = route<{ date: string; subscriberId: string }>(async ({ params, request, getActor, requestId }) => {
  const { date, subscriberId } = parseParams(params, paramsSchema);
  assertReasonableDate(date, kitchenDate(new Date()));
  const { status } = await parseBody(request, setVesselSchema);
  return ok(await setVesselState(date, subscriberId, status, { actor: await getActor(), requestId }));
});
