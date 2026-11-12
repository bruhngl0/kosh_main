import { z } from "zod";
import { syncFromOnboarding } from "@/modules/subscribers";
import { created, ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { resolveOnboardingActor } from "@/server/integration";
import { onboardingSyncSchema } from "@/shared/schemas/subscribers";

const paramsSchema = z.object({ submissionId: uuidParam });

/**
 * BR-23 — called by the onboarding app when a submission is confirmed.
 * Authenticated with a service token, not the operations user. Idempotent:
 * PUT to the same submission id creates once, then updates.
 */
export const PUT = route<{ submissionId: string }>(async ({ params, request, requestId }) => {
  const actor = await resolveOnboardingActor(request);
  const { submissionId } = parseParams(params, paramsSchema);
  const input = await parseBody(request, onboardingSyncSchema);
  const result = await syncFromOnboarding(submissionId, input, { actor, requestId });
  return result.created ? created(result) : ok(result);
});
