import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { makeCycle, makeRecipe } from "../support/factories";
import { addRunSheetTask, getRunSheet, removeRunSheetTask, setCheck, setVesselState, updateRunSheet } from "@/modules/runsheet";
import * as sheetRoute from "@/app/api/v1/run-sheets/[date]/route";
import type { Actor } from "@/server/actor";

/** BR-26..BR-29 against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });
const DAY = "2026-08-05"; // day 3 of a cycle starting 2026-08-03

async function seedDay() {
  const cycle = await makeCycle({ status: "ACTIVE", durationDays: 7 });
  const snack = await makeRecipe({ title: "Cottage Cheese", mealType: "SN" });
  const dinner = await makeRecipe({ title: "Miso Salmon", mealType: "DI", proteinSource: "salmon" });
  await db.recipeAllergen.createMany({
    data: [
      { recipeVersionId: snack.version.id, allergenCode: "Dairy" },
      { recipeVersionId: dinner.version.id, allergenCode: "Fish" },
      { recipeVersionId: dinner.version.id, allergenCode: "Gluten (tamari)" },
    ],
  });
  const day3 = cycle.days[2];
  await db.mealAssignment.createMany({
    data: [
      { cycleDayId: day3.id, mealType: "SN", recipeVersionId: snack.version.id, servings: 3 },
      { cycleDayId: day3.id, mealType: "DI", recipeVersionId: dinner.version.id, servings: 3 },
    ],
  });
  const [asha, ravi] = await Promise.all([
    db.subscriber.create({ data: { name: "Asha", status: "active", allergies: ["lactose intolerant"] } }),
    db.subscriber.create({ data: { name: "Ravi", status: "active", allergies: ["kiwi"] } }),
    db.subscriber.create({ data: { name: "Paused Pat", status: "paused" } }),
    db.subscriber.create({ data: { name: "Late Lata", status: "active", startDate: new Date("2026-08-07T00:00:00Z") } }),
  ]);
  return { cycle, asha, ravi };
}

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

describe("BR-26 the derived sheet", () => {
  it("finds the cycle day, menu, delivery list and allergen clashes for a date", async () => {
    await seedDay();
    const sheet = await getRunSheet(DAY);

    expect(sheet.cycle).toMatchObject({ dayNumber: 3, status: "ACTIVE" });
    expect(sheet.meals.map((meal) => meal.title)).toEqual(["Cottage Cheese", "Miso Salmon"]);
    expect(sheet.macros.kcal).toBe(1000);
    expect(sheet.vessels.map((v) => v.name)).toEqual(["Asha", "Ravi"]);
    expect(sheet.roster).toMatchObject({ count: 2, startingSoon: 1, plannedServings: 3 });

    const asha = sheet.allergyAlerts.find((alert) => alert.name === "Asha")!;
    expect(asha.clashes).toEqual([
      expect.objectContaining({ dish: "Cottage Cheese", allergen: "Dairy", meal: "Snack" }),
    ]);
    expect(sheet.allergyAlerts.find((alert) => alert.name === "Ravi")?.unrecognised).toEqual(["kiwi"]);
    expect(sheet.vessels.find((v) => v.name === "Asha")?.flagged).toBe(true);
  });

  it("still serves a checklist when no cycle covers the date, and points at one that does", async () => {
    await seedDay();
    const sheet = await getRunSheet("2026-11-12");
    expect(sheet.cycle).toBeNull();
    expect(sheet.meals).toEqual([]);
    expect(sheet.phases.length).toBeGreaterThan(0);
    expect(sheet.cycleRanges).toEqual([expect.objectContaining({ from: "2026-08-03", to: "2026-08-09" })]);
  });

  it("creates nothing by being viewed", async () => {
    await getRunSheet(DAY);
    const response = await sheetRoute.GET(new Request(`http://localhost/api/v1/run-sheets/${DAY}`), {
      params: Promise.resolve({ date: DAY }),
    });
    expect(response.status).toBe(200);
    expect(await db.runSheet.count()).toBe(0);
  });
});

describe("BR-27 checklist", () => {
  it("records who ticked a task, and unticking removes it", async () => {
    await setCheck(DAY, { taskKey: "p1", done: true }, context());
    let sheet = await getRunSheet(DAY);
    const task = sheet.phases[0].tasks.find((t) => t.key === "p1")!;
    expect(task).toMatchObject({ done: true, doneBy: actor.name });
    expect(sheet.progress.done).toBe(1);

    await setCheck(DAY, { taskKey: "p1", done: false }, context());
    sheet = await getRunSheet(DAY);
    expect(sheet.progress.done).toBe(0);
  });

  it("is idempotent under repeated and concurrent ticks", async () => {
    await Promise.all([
      ...Array.from({ length: 5 }, () => setCheck(DAY, { taskKey: "c1", done: true }, context())),
      updateRunSheet(DAY, { chefName: "Chef Rao" }, context()),
      addRunSheetTask(DAY, { phase: "prep", title: "Soak chana", owner: "Chef" }, context()),
    ]);
    expect(await db.runSheet.count()).toBe(1);
    expect(await db.runSheetCheck.count()).toBe(1);
  });

  it("refuses a task key that is neither standard nor added for that day", async () => {
    await expect(setCheck(DAY, { taskKey: "nope", done: true }, context())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("adds, ticks and removes a one-off task; tick-all covers it", async () => {
    const added = await addRunSheetTask(DAY, { phase: "cook", title: "Extra dal batch", owner: "Chef" }, context());
    await setCheck(DAY, { all: true }, context());
    let sheet = await getRunSheet(DAY);
    // Everything except the production task, which only recording production can tick (BR-31).
    expect(sheet.progress).toEqual({ done: sheet.progress.total - 1, total: sheet.progress.total });
    expect(sheet.phases.flatMap((p) => p.tasks).find((t) => t.key === "k0")).toMatchObject({ derived: true, done: false });
    expect(sheet.phases.find((p) => p.id === "cook")!.tasks.at(-1)).toMatchObject({ key: added.id, custom: true, done: true });

    await removeRunSheetTask(DAY, added.id, context());
    sheet = await getRunSheet(DAY);
    expect(sheet.phases.flatMap((p) => p.tasks).some((t) => t.key === added.id)).toBe(false);
    expect(await db.runSheetCheck.count({ where: { taskKey: added.id } })).toBe(0);
    // A task belongs to its own day only.
    await expect(removeRunSheetTask("2026-08-06", added.id, context())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is kitchen work: planners and viewers cannot tick", async () => {
    const viewer = await seedActor("VIEWER");
    await expect(setCheck(DAY, { taskKey: "p1", done: true }, { actor: viewer, requestId: "r" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const kitchen = await seedActor("KITCHEN");
    await expect(setCheck(DAY, { taskKey: "p1", done: true }, { actor: kitchen, requestId: "r" })).resolves.toBeTruthy();
  });
});

describe("BR-28 vessels", () => {
  it("moves a vessel through its states and back to not dispatched", async () => {
    const { asha } = await seedDay();
    await setVesselState(DAY, asha.id, "out", context());
    await setVesselState(DAY, asha.id, "collected", context());
    expect((await getRunSheet(DAY)).vessels.find((v) => v.id === asha.id)?.vessel).toBe("collected");
    await setVesselState(DAY, asha.id, null, context());
    expect((await getRunSheet(DAY)).vessels.find((v) => v.id === asha.id)?.vessel).toBeNull();
  });

  it("reports an unknown subscriber as not found and the database refuses unknown states", async () => {
    await expect(setVesselState(DAY, "00000000-0000-4000-8000-000000000000", "out", context())).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The failed write rolled back whole, including the sheet it would have created.
    expect(await db.runSheet.count()).toBe(0);
    const { asha } = await seedDay();
    const sheet = await db.runSheet.create({ data: { productionDate: new Date(`${DAY}T00:00:00Z`) } });
    await expect(
      db.$executeRaw`INSERT INTO vessel_dispatches (id, run_sheet_id, subscriber_id, status, updated_at) VALUES (gen_random_uuid(), ${sheet.id}::uuid, ${asha.id}::uuid, 'lost', NOW())`,
    ).rejects.toThrow(/vessel_dispatches_status_known/);
  });
});

describe("run sheet brief", () => {
  it("saves chef and notes, audits the change, and clears with blank", async () => {
    await updateRunSheet(DAY, { chefName: "Chef Rao", notes: "Salmon short by 2" }, context());
    await updateRunSheet(DAY, { chefName: null }, context());
    const sheet = await getRunSheet(DAY);
    expect(sheet.brief).toMatchObject({ chefName: null, notes: "Salmon short by 2" });
    expect(await db.auditEvent.count({ where: { action: "run_sheet.updated" } })).toBe(2);
  });

  it("refuses writes to a date more than a year away", async () => {
    const response = await sheetRoute.PATCH(
      new Request("http://localhost/api/v1/run-sheets/2036-08-05", { method: "PATCH", body: JSON.stringify({ notes: "x" }) }),
      { params: Promise.resolve({ date: "2036-08-05" }) },
    );
    expect(response.status).toBe(422);
  });
});
