import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { balanceOf, makeCycle, makeIngredient, makeRecipe } from "../support/factories";
import { consumeProduction } from "@/modules/production";
import { getRunSheet, setCheck, setVesselState } from "@/modules/runsheet";
import type { Actor } from "@/server/actor";

/** BR-31 (run sheet → inventory) and BR-32 (run sheet → vessel kits) against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });
const DAY = "2026-08-05"; // day 3 of a cycle starting 2026-08-03

/** An ACTIVE cycle with lunch and dinner on day 3, 2 servings each, 100 g of rice per serving. */
async function kitchen(stockKg = 10) {
  const cycle = await makeCycle({ status: "ACTIVE", durationDays: 7, subscriberCount: 2 });
  const rice = await makeIngredient({ name: "Rice", defaultUnit: "kg", quantity: stockKg });
  const lunch = await makeRecipe({ mealType: "LU", ingredients: [{ ingredientId: rice.id, quantity: 100, unit: "g" }] });
  const dinner = await makeRecipe({ mealType: "DI", ingredients: [{ ingredientId: rice.id, quantity: 100, unit: "g" }] });
  await db.mealAssignment.createMany({
    data: [
      { cycleDayId: cycle.days[2].id, mealType: "LU", recipeVersionId: lunch.version.id, servings: 2 },
      { cycleDayId: cycle.days[2].id, mealType: "DI", recipeVersionId: dinner.version.id, servings: 2 },
    ],
  });
  return { cycle, rice, target: { cycleId: cycle.id, dayNumber: 3 } };
}

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

describe("BR-31 production is taken off stock once", () => {
  it("previews the day's needs against stock, shortages first", async () => {
    await kitchen(0.3);
    const sheet = await getRunSheet(DAY);
    expect(sheet.stock).toMatchObject({ pendingMeals: ["LU", "DI"], runs: [] });
    expect(sheet.stock!.lines).toEqual([expect.objectContaining({ ingredientName: "Rice", needed: 0.4, onHand: 0.3, shortBy: 0.1, unit: "kg" })]);
  });

  it("consumes once; a second press is a conflict and stock moves only once", async () => {
    const { rice, target } = await kitchen();
    await consumeProduction(target, { allowNegative: false }, context());
    expect(await balanceOf(rice.id)).toBeCloseTo(9.6);
    await expect(consumeProduction(target, { allowNegative: false }, context())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await balanceOf(rice.id)).toBeCloseTo(9.6);
  });

  it("two people pressing at once deduct once", async () => {
    const { rice, target } = await kitchen();
    const results = await Promise.allSettled([
      consumeProduction(target, { allowNegative: false }, context()),
      consumeProduction(target, { allowNegative: false }, context()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await balanceOf(rice.id)).toBeCloseTo(9.6);
    expect(await db.productionRun.count()).toBe(2);
  });

  it("records meal by meal: the rest can follow, a recorded meal cannot repeat", async () => {
    const { rice, target } = await kitchen();
    await consumeProduction(target, { meals: ["LU"], allowNegative: false }, context());
    await expect(consumeProduction(target, { meals: ["LU"], allowNegative: false }, context())).rejects.toMatchObject({ code: "CONFLICT" });
    const rest = await consumeProduction(target, { allowNegative: false }, context());
    expect(rest.meals).toEqual(["DI"]);
    expect(await balanceOf(rice.id)).toBeCloseTo(9.6);
  });

  it("a refused run (short stock) claims nothing, and the override is recorded", async () => {
    const { target } = await kitchen(0.1);
    await expect(consumeProduction(target, { allowNegative: false }, context())).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await db.productionRun.count()).toBe(0);
    await consumeProduction(target, { allowNegative: true }, context());
    expect(await db.productionRun.findMany()).toEqual(expect.arrayContaining([expect.objectContaining({ negativeOverride: true })]));
  });

  it("the production task ticks itself, and cannot be ticked by hand", async () => {
    const { target } = await kitchen();
    await expect(setCheck(DAY, { taskKey: "k0", done: true }, context())).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await consumeProduction(target, { allowNegative: false }, context());
    const sheet = await getRunSheet(DAY);
    expect(sheet.phases.flatMap((p) => p.tasks).find((t) => t.key === "k0")).toMatchObject({ done: true, doneBy: actor.name });
    expect(sheet.stock).toMatchObject({ pendingMeals: [], lines: [] });
    expect(sheet.stock!.runs.map((r) => r.mealType)).toEqual(["LU", "DI"]);
  });
});

describe("BR-32 vessels and kits", () => {
  async function subscriberWithKit(name: string, kit?: { status?: string; sanitisedAt?: Date | null }) {
    const subscriber = await db.subscriber.create({ data: { name, status: "active" } });
    if (kit) {
      await db.vesselKit.create({
        data: { subscriberId: subscriber.id, type: "steel", status: kit.status ?? "active", sets: 2, sanitisedAt: kit.sanitisedAt ?? null },
      });
    }
    return subscriber;
  }

  it("shows each delivery's kit, and flags a missing one", async () => {
    await subscriberWithKit("Asha", { sanitisedAt: new Date("2026-08-01T00:00:00Z") });
    await subscriberWithKit("Ravi");
    const sheet = await getRunSheet(DAY);
    expect(sheet.vessels.find((v) => v.name === "Asha")?.kit).toMatchObject({ type: "steel", status: "active", sets: 2 });
    expect(sheet.vessels.find((v) => v.name === "Ravi")?.kit).toBeNull();
  });

  it("ticking the wash stamps today's date on every collected vessel's kit, and never moves it back", async () => {
    const asha = await subscriberWithKit("Asha", { sanitisedAt: new Date("2026-07-01T00:00:00Z") });
    const ravi = await subscriberWithKit("Ravi", { sanitisedAt: new Date("2026-08-09T00:00:00Z") }); // already later
    const lata = await subscriberWithKit("Lata", { sanitisedAt: null });
    await setVesselState(DAY, asha.id, "collected", context());
    await setVesselState(DAY, ravi.id, "collected", context());
    await setVesselState(DAY, lata.id, "missing", context());

    const result = await setCheck(DAY, { taskKey: "e6", done: true }, context());
    expect(result).toMatchObject({ sanitised: 1 });

    const kits = await db.vesselKit.findMany({ include: { subscriber: true } });
    const date = (name: string) => kits.find((k) => k.subscriber.name === name)?.sanitisedAt?.toISOString().slice(0, 10) ?? null;
    expect(date("Asha")).toBe(DAY);
    expect(date("Ravi")).toBe("2026-08-09");
    expect(date("Lata")).toBeNull();
    expect(await db.auditEvent.count({ where: { action: "vessel_kit.sanitised" } })).toBe(1);
  });

  it("a vessel logged as collected after the wash was ticked is stamped too", async () => {
    const asha = await subscriberWithKit("Asha", { sanitisedAt: null });
    await setCheck(DAY, { taskKey: "e6", done: true }, context());
    await expect(setVesselState(DAY, asha.id, "collected", context())).resolves.toMatchObject({ sanitised: 1 });
    expect((await db.vesselKit.findFirstOrThrow()).sanitisedAt?.toISOString().slice(0, 10)).toBe(DAY);
  });

  it("carries a missing vessel forward until it is seen again", async () => {
    const asha = await subscriberWithKit("Asha", {});
    await setVesselState("2026-08-03", asha.id, "missing", context());
    await setVesselState("2026-08-04", asha.id, "missing", context());
    expect((await getRunSheet(DAY)).vessels[0].missingSince).toBe("2026-08-03");

    await setVesselState("2026-08-04", asha.id, "collected", context());
    expect((await getRunSheet(DAY)).vessels[0].missingSince).toBeNull();
  });
});
