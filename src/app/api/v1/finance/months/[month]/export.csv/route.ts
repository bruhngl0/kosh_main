import { z } from "zod";
import { exportMonthCsv } from "@/modules/finance";
import { parseParams, route } from "@/server/http";
import { monthSchema } from "@/shared/schemas/finance";

const paramsSchema = z.object({ month: monthSchema });

/** The `route()` wrapper only rewrites JSON bodies, so a file passes through untouched. */
export const GET = route<{ month: string }>(async ({ params }) => {
  const { month } = parseParams(params, paramsSchema);
  const csv = await exportMonthCsv(month);
  // U+FEFF byte-order mark so Excel reads ₹ and ō as UTF-8.
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="Kosh_CashFlow_${month}.csv"`,
      "cache-control": "no-store",
    },
  });
});
