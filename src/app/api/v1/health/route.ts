import { db } from "@/server/db";
import { ok, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const startedAt = Date.now();
  await db.$queryRaw`SELECT 1`;
  return ok({
    status: "ok",
    service: "kosh",
    databaseLatencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
});
