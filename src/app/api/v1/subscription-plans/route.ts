import { listSubscriptionPlans } from "@/modules/subscribers";
import { ok, route } from "@/server/http";

export const GET = route(async () => ok(await listSubscriptionPlans()));
