import { z } from "zod";
import { linkVendorIngredient } from "@/modules/vendors";
import { ok, parseBody, parseParams, route, uuidParam } from "@/server/http";
import { linkVendorIngredientSchema } from "@/shared/schemas/procurement";

const paramsSchema = z.object({ id: uuidParam, ingredientId: uuidParam });

/**
 * Sets price, purchase unit, and the preferred flag that BR-7 groups by.
 * Preference is exclusive — this clears it on every other vendor.
 */
export const PUT = route<{ id: string; ingredientId: string }>(
  async ({ params, request, getActor, requestId }) => {
    const { id, ingredientId } = parseParams(params, paramsSchema);
    const input = await parseBody(request, linkVendorIngredientSchema);
    return ok(
      await linkVendorIngredient(id, ingredientId, input, { actor: await getActor(), requestId }),
    );
  },
);
