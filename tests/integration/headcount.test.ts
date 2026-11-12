import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { makeCycle, makeRecipe } from "../support/factories";
import { assignMeal, syncCycleHeadcount, updateCycle } from "@/modules/cycles";
import { createSubscriber, syncFromOnboarding, updateSubscriber } from "@/modules/subscribers";
import { onboardingSyncSchema } from "@/shared/schemas/subscribers";
import { kitchenDate } from "@/shared/kitchen-date";
import type { Actor } from "@/server/actor";

/** BR-30 against a real database. Dates are relative to the real today, because "past days are frozen" depends on it. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });

const shift = (days: number) => {
  const date = new Date(`${kitchenDate(new Date())}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};
const iso = (days: number) => shift(days).toISOString().slice(0, 10);

/** A 5-day cycle running from yesterday, lunch assigned every day at a stale count of 10. */
async function scenario() {
  const cycle = await makeCycle({ status: "ACTIVE", durationDays: 5, weekStart: shift(-1), subscriberCount: 10 });
  const { version } = await makeRecipe({ mealType: "LU" });
  await db.mealAssignment.createMany({
    data: cycle.days.map((day) => ({ cycleDayId: day.id, mealType: "LU" as const, recipeVersionId: version.id, servings: 10 })),
  });
  return { cycle, version };
}

const servingsByDay = async (cycleId: string) => {
  const rows = await db.mealAssignment.findMany({
    where: { cycleDay: { cycleId } },
    select: { servings: true, servingsLocked: true, cycleDay: { select: { dayNumber: true } } },
    orderBy: { cycleDay: { dayNumber: "asc" } },
  });
  return rows.map((row) => row.servings);
};

const active = (name: string, startDays?: number) =>
  createSubscriber(
    { name, status: "active", planId: null, allergies: [], ...(startDays === undefined ? {} : { startDate: iso(startDays) }) } as never,
    context(),
  );

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

describe("BR-30 servings follow the roster", () => {
  it("adding subscribers moves today and future days, day by day, and leaves yesterday alone", async () => {
    const { cycle } = await scenario();
    await active("Asha");
    await active("Ravi");
    const result = await active("Lata", 2); // starts the day after tomorrow

    // Day 1 = yesterday (frozen), day 2 = today, day 3 = tomorrow, days 4–5 include Lata.
    expect(await servingsByDay(cycle.id)).toEqual([10, 2, 2, 3, 3]);
    expect(result.servingsChanged).toEqual([{ cycleName: cycle.name, changed: 2, headcount: 2 }]);

    const after = await db.cycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(after.subscriberCount).toBe(2);
    expect(after.headcountSyncedAt).not.toBeNull();
    expect(await db.auditEvent.count({ where: { action: "cycle.headcount_synced" } })).toBeGreaterThan(0);
  });

  it("pausing someone drops their portions in the same transaction", async () => {
    const { cycle } = await scenario();
    const asha = await active("Asha");
    await active("Ravi");
    await updateSubscriber(asha.id, { status: "paused" }, context());
    expect(await servingsByDay(cycle.id)).toEqual([10, 1, 1, 1, 1]);
  });

  it("edits that do not change who is delivered to leave servings alone", async () => {
    const { cycle } = await scenario();
    const asha = await active("Asha");
    await db.mealAssignment.updateMany({ data: { servings: 7 } });
    const result = await updateSubscriber(asha.id, { phone: "+919845000000" }, context());
    expect(result.servingsChanged).toEqual([]);
    expect(await servingsByDay(cycle.id)).toEqual([7, 7, 7, 7, 7]);
  });

  it("onboarding syncs never move servings: a new applicant is not yet delivered to", async () => {
    const { cycle } = await scenario();
    await active("Asha");
    const input = onboardingSyncSchema.parse({ ref: "KSH-AB12C", name: "New Applicant" });
    await syncFromOnboarding("6f1c2b9e-4d3a-4e8f-9a1b-2c3d4e5f6a7b", input, { actor, requestId: "r" });
    expect(await servingsByDay(cycle.id)).toEqual([10, 1, 1, 1, 1]);
  });

  it("keeps servings set by hand, and hands them back to the roster on request", async () => {
    const { cycle, version } = await scenario();
    await assignMeal({ cycleId: cycle.id, dayNumber: 3, mealType: "LU" }, { recipeVersionId: version.id, servings: 45 }, context());
    await active("Asha");
    expect((await servingsByDay(cycle.id))[2]).toBe(45);

    // Swapping the dish without saying otherwise keeps the hand-set figure.
    const { version: other } = await makeRecipe({ mealType: "LU" });
    await assignMeal({ cycleId: cycle.id, dayNumber: 3, mealType: "LU" }, { recipeVersionId: other.id }, context());
    expect((await servingsByDay(cycle.id))[2]).toBe(45);

    await assignMeal({ cycleId: cycle.id, dayNumber: 3, mealType: "LU" }, { recipeVersionId: other.id, servings: null }, context());
    const row = await db.mealAssignment.findFirstOrThrow({ where: { cycleDay: { cycleId: cycle.id, dayNumber: 3 } } });
    expect(row).toMatchObject({ servings: 1, servingsLocked: false });
  });

  it("fills a new slot at that day's roster count", async () => {
    const cycle = await makeCycle({ status: "ACTIVE", durationDays: 5, weekStart: shift(0), subscriberCount: 10 });
    const { version } = await makeRecipe({ mealType: "DI" });
    await active("Asha");
    await active("Lata", 3);
    const assignment = await assignMeal({ cycleId: cycle.id, dayNumber: 5, mealType: "DI" }, { recipeVersionId: version.id }, context());
    expect(assignment).toMatchObject({ servings: 2, servingsLocked: false });
  });

  it("keeps the typed head-count while the roster is empty", async () => {
    const { cycle } = await scenario();
    const result = await syncCycleHeadcount(cycle.id, context());
    expect(result).toMatchObject({ source: "cycle", headcount: 10, changed: 0 });
    expect(await servingsByDay(cycle.id)).toEqual([10, 10, 10, 10, 10]);
  });

  it("does not touch closed cycles", async () => {
    const { cycle } = await scenario();
    await db.cycle.update({ where: { id: cycle.id }, data: { status: "CLOSED" } });
    await active("Asha");
    expect(await servingsByDay(cycle.id)).toEqual([10, 10, 10, 10, 10]);
    await expect(syncCycleHeadcount(cycle.id, context())).resolves.toMatchObject({ closed: true });
  });

  it("re-runs when the start date moves, since every meal lands on a different roster day", async () => {
    const { cycle } = await scenario();
    await active("Asha");
    await active("Lata", 10);
    await updateCycle(cycle.id, { weekStart: shift(8) }, context());
    // Days now run 8..12 days out; Lata delivers from day 10, i.e. days 3–5.
    expect(await servingsByDay(cycle.id)).toEqual([1, 1, 2, 2, 2]);
    expect((await db.cycle.findUniqueOrThrow({ where: { id: cycle.id } })).subscriberCount).toBe(1);
  });

  it("is a planner action: viewers cannot sync", async () => {
    const { cycle } = await scenario();
    const viewer = await seedActor("VIEWER");
    await expect(syncCycleHeadcount(cycle.id, { actor: viewer, requestId: "r" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the database refuses zero servings", async () => {
    const { cycle } = await scenario();
    await expect(db.mealAssignment.updateMany({ where: { cycleDay: { cycleId: cycle.id } }, data: { servings: 0 } })).rejects.toThrow(
      /meal_assignments_servings_positive/,
    );
  });
});
