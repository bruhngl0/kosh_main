import { getVesselSummary } from "@/modules/vessels";
import { ok, route } from "@/server/http";

/** BR-18 — rotation view, including kits overdue for sanitisation. */
export const GET = route(async () => ok(await getVesselSummary()));
