import { assignMeal, clearMeal } from "@/modules/cycles";
import { ok, parseBody, parseParams, route } from "@/server/http";
import { assignMealSchema, mealSlotParamsSchema } from "@/shared/schemas/cycle";

type Params = { id: string; day: string; meal: string };

/**
 * BR-5. Path params go through Zod, so an unknown meal or a non-numeric day is
 * a 400 rather than a Prisma error surfacing as a 500.
 */
export const PUT = route<Params>(async ({ params, request, getActor, requestId }) => {
  const { id, day, meal } = parseParams(params, mealSlotParamsSchema);
  const input = await parseBody(request, assignMealSchema);
  const assignment = await assignMeal(
    { cycleId: id, dayNumber: day, mealType: meal },
    input,
    { actor: await getActor(), requestId },
  );
  return ok(assignment);
});

export const DELETE = route<Params>(async ({ params, getActor, requestId }) => {
  const { id, day, meal } = parseParams(params, mealSlotParamsSchema);
  return ok(
    await clearMeal({ cycleId: id, dayNumber: day, mealType: meal }, { actor: await getActor(), requestId }),
  );
});
