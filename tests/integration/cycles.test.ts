import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { balanceOf, fillCycle, makeCycle, makeIngredient, makeRecipe } from "../support/factories";
import { assignMeal, publishCycle } from "@/modules/cycles";
import { consumeProduction, generatePrepTasks, updatePrepTask } from "@/modules/production";
import type { Actor } from "@/server/actor";

/** BR-3, BR-4, BR-5, BR-14, BR-16 against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

async function fullCycle() {
  const meals = await Promise.all([
    makeRecipe({ mealType: "BF", title: "Bhurji" }),
    makeRecipe({ mealType: "SN", title: "Makhana" }),
    makeRecipe({ mealType: "LU", title: "Chettinad" }),
    makeRecipe({ mealType: "DI", title: "Miso Salmon" }),
  ]);
  const cycle = await makeCycle({ durationDays: 7 });
  await fillCycle(cycle.id, {
    BF: meals[0].version.id,
    SN: meals[1].version.id,
    LU: meals[2].version.id,
    DI: meals[3].version.id,
  });
  return { cycle, meals };
}

describe("publishCycle (BR-4)", () => {
  it("activates a fully assigned cycle", async () => {
    const { cycle } = await fullCycle();
    const published = await publishCycle(cycle.id, context());
    expect(published.status).toBe("ACTIVE");
    expect(published.publishedAt).not.toBeNull();
  });

  it("refuses and reports the days that are incomplete", async () => {
    const cycle = await makeCycle({ durationDays: 3 });

    await expect(publishCycle(cycle.id, context())).rejects.toMatchObject({
      code: "UNPROCESSABLE",
      details: { incompleteDayNumbers: [1, 2, 3] },
    });

    const unchanged = await db.cycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(unchanged.status).toBe("DRAFT");
  });

  it("refuses when a slot holds an unpublished recipe version", async () => {
    const meals = await Promise.all([
      makeRecipe({ mealType: "BF" }),
      makeRecipe({ mealType: "SN" }),
      makeRecipe({ mealType: "LU" }),
      makeRecipe({ mealType: "DI", status: "DRAFT" }),
    ]);
    const cycle = await makeCycle({ durationDays: 1 });
    await fillCycle(cycle.id, {
      BF: meals[0].version.id,
      SN: meals[1].version.id,
      LU: meals[2].version.id,
      DI: meals[3].version.id,
    });

    await expect(publishCycle(cycle.id, context())).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("cannot publish twice", async () => {
    const { cycle } = await fullCycle();
    await publishCycle(cycle.id, context());
    await expect(publishCycle(cycle.id, context())).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});

describe("assignMeal (BR-5)", () => {
  it("refuses a recipe whose meal type does not match the slot", async () => {
    const cycle = await makeCycle({ durationDays: 1 });
    const { version } = await makeRecipe({ mealType: "LU", title: "Lunch dish" });

    await expect(
      assignMeal({ cycleId: cycle.id, dayNumber: 1, mealType: "BF" }, { recipeVersionId: version.id }, context()),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("defaults servings to the cycle subscriber count", async () => {
    const cycle = await makeCycle({ durationDays: 1, subscriberCount: 37 });
    const { version } = await makeRecipe({ mealType: "BF" });

    const assignment = await assignMeal(
      { cycleId: cycle.id, dayNumber: 1, mealType: "BF" },
      { recipeVersionId: version.id },
      context(),
    );

    expect(assignment.servings).toBe(37);
  });

  it("replaces an existing assignment rather than duplicating", async () => {
    const cycle = await makeCycle({ durationDays: 1 });
    const first = await makeRecipe({ mealType: "BF", title: "First" });
    const second = await makeRecipe({ mealType: "BF", title: "Second" });

    await assignMeal({ cycleId: cycle.id, dayNumber: 1, mealType: "BF" }, { recipeVersionId: first.version.id }, context());
    await assignMeal({ cycleId: cycle.id, dayNumber: 1, mealType: "BF" }, { recipeVersionId: second.version.id }, context());

    expect(await db.mealAssignment.count()).toBe(1);
  });

  it("rejects a day that does not exist", async () => {
    const cycle = await makeCycle({ durationDays: 1 });
    const { version } = await makeRecipe({ mealType: "BF" });

    await expect(
      assignMeal({ cycleId: cycle.id, dayNumber: 99, mealType: "BF" }, { recipeVersionId: version.id }, context()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("generatePrepTasks (BR-3, BR-16)", () => {
  async function cycleWithPrep() {
    const { version } = await makeRecipe({
      mealType: "DI",
      steps: [
        { stepNumber: 1, title: "Sear", instructions: "Sear the fillet.", criticality: "info" },
        { stepNumber: 2, title: "Marinate", instructions: "Marinate salmon 24HR PRIOR", criticality: "mandatory" },
      ],
    });
    const cycle = await makeCycle({ durationDays: 2, weekStart: new Date("2026-08-03T00:00:00.000Z") });
    await fillCycle(cycle.id, { DI: version.id });
    return cycle;
  }

  it("derives tasks only from non-info steps, with lead time and due date", async () => {
    const cycle = await cycleWithPrep();
    const result = await generatePrepTasks(cycle.id, context());

    expect(result.created).toBe(2); // one per day
    const tasks = await db.prepTask.findMany({ orderBy: { dueDate: "asc" } });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].taskType).toBe("H24");
    expect(tasks[0].urgent).toBe(true);
    // Day 1 is 3 Aug; 24hr prior is 2 Aug.
    expect(tasks[0].dueDate?.toISOString().slice(0, 10)).toBe("2026-08-02");
  });

  it("re-running creates no duplicates", async () => {
    const cycle = await cycleWithPrep();
    await generatePrepTasks(cycle.id, context());
    const second = await generatePrepTasks(cycle.id, context());

    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(await db.prepTask.count()).toBe(2);
  });

  // The bug the old delete-and-recreate approach caused.
  it("preserves completed work across regeneration", async () => {
    const cycle = await cycleWithPrep();
    await generatePrepTasks(cycle.id, context());

    const task = await db.prepTask.findFirstOrThrow();
    await updatePrepTask(task.id, "DONE", context());

    await generatePrepTasks(cycle.id, context());

    const after = await db.prepTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("DONE");
    expect(after.completedById).toBe(actor.id);
    expect(await db.prepTask.count()).toBe(2);
  });

  it("removes open tasks that the menu no longer requires", async () => {
    const cycle = await cycleWithPrep();
    await generatePrepTasks(cycle.id, context());
    expect(await db.prepTask.count()).toBe(2);

    await db.mealAssignment.deleteMany({});
    const result = await generatePrepTasks(cycle.id, context());

    expect(result.removed).toBe(2);
    expect(await db.prepTask.count()).toBe(0);
  });

  it("keeps completed tasks even when the menu no longer requires them", async () => {
    const cycle = await cycleWithPrep();
    await generatePrepTasks(cycle.id, context());
    const task = await db.prepTask.findFirstOrThrow();
    await updatePrepTask(task.id, "DONE", context());

    await db.mealAssignment.deleteMany({});
    await generatePrepTasks(cycle.id, context());

    // The completed one survives as a record of work actually done.
    expect(await db.prepTask.count()).toBe(1);
    expect((await db.prepTask.findFirstOrThrow()).status).toBe("DONE");
  });
});

describe("consumeProduction (BR-14)", () => {
  async function activeCycleWithStock(stock: number) {
    const chicken = await makeIngredient({ name: "Chicken", defaultUnit: "kg", quantity: stock });
    const meals = await Promise.all([
      makeRecipe({ mealType: "BF" }),
      makeRecipe({ mealType: "SN" }),
      makeRecipe({
        mealType: "LU",
        ingredients: [{ ingredientId: chicken.id, quantity: 150, unit: "g" }],
      }),
      makeRecipe({ mealType: "DI" }),
    ]);
    const cycle = await makeCycle({ durationDays: 1, subscriberCount: 10 });
    await fillCycle(cycle.id, {
      BF: meals[0].version.id,
      SN: meals[1].version.id,
      LU: meals[2].version.id,
      DI: meals[3].version.id,
    });
    await publishCycle(cycle.id, context());
    return { cycle, chicken };
  }

  it("consumes stock for the meals produced", async () => {
    const { cycle, chicken } = await activeCycleWithStock(5);

    const result = await consumeProduction(
      { cycleId: cycle.id, dayNumber: 1 },
      { meals: ["LU"], allowNegative: false },
      context(),
    );

    // 150 g × 10 servings = 1.5 kg
    expect(result.consumed).toHaveLength(1);
    expect(await balanceOf(chicken.id)).toBe(3.5);
  });

  it("refuses when stock is insufficient", async () => {
    const { cycle, chicken } = await activeCycleWithStock(0.5);

    await expect(
      consumeProduction({ cycleId: cycle.id, dayNumber: 1 }, { meals: ["LU"], allowNegative: false }, context()),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await balanceOf(chicken.id)).toBe(0.5);
  });

  it("allows an authorised override", async () => {
    const { cycle, chicken } = await activeCycleWithStock(0.5);

    await consumeProduction(
      { cycleId: cycle.id, dayNumber: 1 },
      { meals: ["LU"], allowNegative: true },
      context(),
    );

    expect(await balanceOf(chicken.id)).toBe(-1);
  });

  it("refuses to record production against a draft cycle", async () => {
    const cycle = await makeCycle({ durationDays: 1, cycleNumber: 7 });
    await expect(
      consumeProduction({ cycleId: cycle.id, dayNumber: 1 }, { allowNegative: false }, context()),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});
