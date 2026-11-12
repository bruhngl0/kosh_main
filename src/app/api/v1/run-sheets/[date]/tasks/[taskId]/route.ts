import { removeRunSheetTask } from "@/modules/runsheet";
import { noContent, parseParams, route, uuidParam } from "@/server/http";
import { runSheetDateParams } from "@/shared/schemas/run-sheet";

const paramsSchema = runSheetDateParams.extend({ taskId: uuidParam });

/** Removes a task added by hand. Standard checklist tasks cannot be removed. */
export const DELETE = route<{ date: string; taskId: string }>(async ({ params, getActor, requestId }) => {
  const { date, taskId } = parseParams(params, paramsSchema);
  await removeRunSheetTask(date, taskId, { actor: await getActor(), requestId });
  return noContent();
});
