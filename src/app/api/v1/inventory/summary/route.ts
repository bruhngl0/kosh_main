import { getInventorySummary } from "@/modules/inventory";
import { ok, route } from "@/server/http";

export const GET = route(async () => ok(await getInventorySummary()));
