import { buildInventoryCsv } from "@/modules/inventory";
import { errorResponse } from "@/server/http";

/**
 * CSV export. Not built on `route()` because the success path is a file, not
 * the JSON envelope — but errors still go through the same mapping so a
 * database failure cannot leak a stack trace.
 */
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const managedOnly = new URL(request.url).searchParams.get("all") !== "true";
    const csv = await buildInventoryCsv({ managedOnly });
    const filename = `Kosh_Inventory_${new Date().toISOString().slice(0, 10)}.csv`;

    // U+FEFF byte-order mark, written as an escape so it is visible in source.
    return new Response(`\uFEFF${csv}`, {
      headers: {
        // The BOM makes Excel read UTF-8 correctly — ingredient names contain
        // characters like ō and −20°C.
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
