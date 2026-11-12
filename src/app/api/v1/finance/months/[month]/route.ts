import { z } from "zod";
import { getMonthView } from "@/modules/finance";
import { ok, parseParams, route } from "@/server/http";
import { monthSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ month: monthSchema });

export const GET = route<{ month: string }>(async ({ params }) => {
  const { month } = parseParams(params, paramsSchema);
  return ok(await getMonthView(month));
});
