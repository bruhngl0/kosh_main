import { PrismaClient, MealType, RecipeStatus, type Prisma } from "@prisma/client";
import { normaliseIngredientName } from "../../src/shared/schemas/common";
import { parseQuantity } from "../../src/shared/units";

import cycleMenu from "./fixtures/cycle-menu.json";
import recipeCards from "./fixtures/recipes.json";
import vendorFixture from "./fixtures/vendors.json";
import ingredientFixture from "./fixtures/ingredients.json";
import vesselFixture from "./fixtures/vessels.json";

/**
 * Database seed. See docs/system-design.md §11.
 *
 * Data comes from committed JSON fixtures under `fixtures/`, extracted from the
 * three HTML prototypes. The previous seed regex-scraped the HTML at run time,
 * which made seeding depend on files that are scheduled for deletion.
 *
 * Idempotent: safe to re-run against an existing database.
 */

const db = new PrismaClient();

const MEAL_KEYS = ["bf", "sn", "lu", "di"] as const;
const MEAL_TYPES: Record<(typeof MEAL_KEYS)[number], MealType> = {
  bf: MealType.BF,
  sn: MealType.SN,
  lu: MealType.LU,
  di: MealType.DI,
};

type MenuMeal = { title: string; sub: string; protein: string; kcal: number; prot: number; adv: string[]; allergens: string[] };
type MenuDay = { day: number; week: number } & Record<(typeof MEAL_KEYS)[number], MenuMeal>;
type RecipeCard = {
  id: string; day: number; week: number; meal: (typeof MEAL_KEYS)[number];
  title: string; subtitle: string; kcal: number; prot: number; carbs: number; fat: number;
  ingredients: { name: string; qty: string; note?: string }[];
  steps: { title: string; text: string; crits: { type: string; text: string }[] }[];
  allergens: string[]; advance: string[]; plating: string;
};

const menu = cycleMenu as MenuDay[];
const cards = recipeCards as RecipeCard[];

/**
 * The 22/10/5 subscriber mix the prototype hardcoded into its revenue formula
 * (Kosh_Inventory.html:872), now expressed as real plans so BR-17 reflects the
 * actual roster.
 */
const PLANS = [
  { name: "Full Board", dailyRate: 2400, count: 22 },
  { name: "Standard", dailyRate: 1800, count: 10 },
  { name: "Light", dailyRate: 1600, count: 5 },
];

async function main() {
  console.log("Seeding Kōsh…");

  await assertSafeToSeed();

  const actor = await seedUsers();
  const subscribers = await seedPlansAndSubscribers();
  const vendors = await seedVendors();
  await seedIngredients(vendors);
  const versionByDayMeal = await seedRecipes();
  await seedCycle(actor.name, versionByDayMeal);
  await seedVesselKits(subscribers);

  console.log("Seed complete.");
}

/**
 * Refuses to run against a database that already holds real operational work.
 *
 * The seed asserts reference data: it rewrites the menu, replaces recipe
 * content, and resets ingredient balances. That is exactly right on an empty
 * database and destructive on a live one. Reference data alone (a seeded cycle,
 * recipes) is fine to overwrite — what must never be lost is the record of what
 * the kitchen actually did.
 *
 * Override with SEED_FORCE=true when you genuinely mean to reset.
 */
async function assertSafeToSeed() {
  if (process.env.SEED_FORCE === "true") {
    console.warn("  SEED_FORCE=true — overwriting existing data.");
    return;
  }

  const [movements, purchaseOrders, completedPrep] = await Promise.all([
    db.inventoryMovement.count(),
    db.purchaseOrder.count(),
    db.prepTask.count({ where: { status: { not: "OPEN" } } }),
  ]);

  const evidence = [
    movements && `${movements} inventory movement(s)`,
    purchaseOrders && `${purchaseOrders} purchase order(s)`,
    completedPrep && `${completedPrep} completed prep task(s)`,
  ].filter(Boolean);

  if (evidence.length) {
    throw new Error(
      `This database already holds operational records: ${evidence.join(", ")}.\n` +
        "Seeding would overwrite the menu and reset stock balances.\n" +
        "Re-run with SEED_FORCE=true only if you intend to discard that work.",
    );
  }
}

async function seedUsers() {
  const actor = await db.user.upsert({
    where: { email: "admin@kosh.local" },
    update: { role: "ADMIN", active: true },
    create: { name: "Kōsh Operations", email: "admin@kosh.local", role: "ADMIN" },
  });

  // Additional roles so authorisation can be exercised without real auth (§8.1).
  for (const user of [
    { name: "Kitchen Lead", email: "kitchen@kosh.local", role: "KITCHEN" as const },
    { name: "Procurement", email: "procurement@kosh.local", role: "PROCUREMENT" as const },
    { name: "Menu Planner", email: "planner@kosh.local", role: "PLANNER" as const },
    { name: "Read Only", email: "viewer@kosh.local", role: "VIEWER" as const },
  ]) {
    await db.user.upsert({ where: { email: user.email }, update: { role: user.role }, create: user });
  }

  console.log("  users: 5");
  return actor;
}

async function seedPlansAndSubscribers() {
  // The five named households come from the vessel registry; the remainder are
  // seed placeholders so the roster totals the 37 the prototype assumed.
  const namedSubscribers = (vesselFixture as { name: string }[]).map((kit) => kit.name);
  const created: { id: string; name: string }[] = [];
  let cursor = 0;

  for (const plan of PLANS) {
    const record = await db.subscriptionPlan.upsert({
      where: { name: plan.name },
      update: { dailyRate: plan.dailyRate, active: true },
      create: { name: plan.name, dailyRate: plan.dailyRate },
    });

    for (let index = 0; index < plan.count; index += 1) {
      const name = namedSubscribers[cursor] ?? `Household ${String(cursor + 1).padStart(2, "0")}`;
      cursor += 1;

      const existing = await db.subscriber.findFirst({ where: { name }, select: { id: true } });
      const subscriber = existing
        ? await db.subscriber.update({ where: { id: existing.id }, data: { planId: record.id } })
        : await db.subscriber.create({ data: { name, planId: record.id } });
      created.push({ id: subscriber.id, name: subscriber.name });
    }
  }

  console.log(`  plans: ${PLANS.length}, subscribers: ${created.length}`);
  return created;
}

async function seedVendors() {
  type VendorRow = {
    id: string; name: string; cat: string; contact: string; whatsapp: string; phone: string;
    email: string; moq: string; lead: string; cutoff: string; area: string; payment: string; notes: string;
  };

  const map = new Map<string, string>();

  for (const row of vendorFixture as VendorRow[]) {
    const data = {
      category: row.cat || null,
      contact: row.contact || null,
      whatsapp: row.whatsapp || null,
      phone: row.phone || null,
      email: row.email || null,
      minimumOrder: row.moq || null,
      leadTime: row.lead || null,
      cutoff: row.cutoff || null,
      area: row.area || null,
      paymentTerms: row.payment || null,
      notes: row.notes || null,
      active: true,
    };

    const vendor = await db.vendor.upsert({
      where: { name: row.name },
      update: data,
      create: { name: row.name, ...data },
    });
    map.set(row.id, vendor.id);
  }

  console.log(`  vendors: ${map.size}`);
  return map;
}

async function seedIngredients(vendors: Map<string, string>) {
  type ItemRow = {
    id: string; name: string; cat: string; freq: string; vendor: string; qty: number;
    unit: string; unitCost: number; status: string; par: number; stock: number; notes: string;
  };

  for (const row of ingredientFixture as ItemRow[]) {
    const normalizedName = normaliseIngredientName(row.name);
    const data = {
      name: row.name,
      category: row.cat,
      defaultUnit: row.unit,
      defaultFrequency: row.freq,
      quantityNeeded: row.qty,
      inventoryStatus: row.status,
      notes: row.notes || null,
      inventoryManaged: true,
      active: true,
    };

    const ingredient = await db.ingredient.upsert({
      where: { normalizedName },
      update: data,
      create: { normalizedName, ...data },
    });

    await db.inventoryBalance.upsert({
      where: { ingredientId: ingredient.id },
      update: { quantity: row.stock, parLevel: row.par, reorderPoint: row.par },
      create: { ingredientId: ingredient.id, quantity: row.stock, parLevel: row.par, reorderPoint: row.par },
    });

    const vendorId = vendors.get(row.vendor);
    if (vendorId) {
      await db.vendorIngredient.upsert({
        where: { vendorId_ingredientId: { vendorId, ingredientId: ingredient.id } },
        update: { preferred: true, unit: row.unit, unitCost: row.unitCost, minimumQty: row.qty },
        create: { vendorId, ingredientId: ingredient.id, preferred: true, unit: row.unit, unitCost: row.unitCost, minimumQty: row.qty },
      });
    }
  }

  console.log(`  ingredients: ${(ingredientFixture as unknown[]).length}`);
}

/**
 * Builds recipes from the detailed cards where they exist, falling back to the
 * planner's menu entry otherwise. Cards are joined to menu slots on (day, meal)
 * rather than title, because the two prototypes spell some dishes differently
 * ("Seared Basa & Lentil Salad" vs "Seared Basa & French Lentil Salad").
 */
async function seedRecipes() {
  const cardBySlot = new Map(cards.map((card) => [`${card.day}:${card.meal}`, card]));
  const versionByDayMeal = new Map<string, string>();
  let detailed = 0;
  let outline = 0;

  for (const day of menu) {
    for (const mealKey of MEAL_KEYS) {
      const slot = `${day.day}:${mealKey}`;
      const mealType = MEAL_TYPES[mealKey];
      const card = cardBySlot.get(slot);
      const menuMeal = day[mealKey];

      const title = card?.title ?? menuMeal.title;
      const subtitle = card?.subtitle ?? menuMeal.sub;

      const recipe = await db.recipe.upsert({
        where: { title_mealType: { title, mealType } },
        update: { subtitle, active: true },
        create: { title, subtitle, mealType },
      });

      const existingVersion = await db.recipeVersion.findFirst({
        where: { recipeId: recipe.id, versionNumber: 1 },
        select: { id: true },
      });

      const versionData = {
        status: RecipeStatus.PUBLISHED,
        publishedAt: new Date(),
        calories: card?.kcal ?? menuMeal.kcal,
        proteinGrams: card?.prot ?? menuMeal.prot,
        carbsGrams: card?.carbs ?? null,
        fatGrams: card?.fat ?? null,
        // Protein source lives only on the planner data.
        proteinSource: menuMeal.protein,
        platingNotes: card?.plating ?? null,
      };

      const version = existingVersion
        ? await db.recipeVersion.update({ where: { id: existingVersion.id }, data: versionData })
        : await db.recipeVersion.create({ data: { recipeId: recipe.id, versionNumber: 1, ...versionData } });

      // Content is replaced wholesale so re-seeding converges.
      await db.recipeIngredient.deleteMany({ where: { recipeVersionId: version.id } });
      await db.recipeStep.deleteMany({ where: { recipeVersionId: version.id } });
      await db.recipeAllergen.deleteMany({ where: { recipeVersionId: version.id } });

      if (card) {
        await seedCardContent(version.id, card);
        detailed += 1;
      } else {
        await seedOutlineContent(version.id, menuMeal);
        outline += 1;
      }

      const allergens = [...new Set(card?.allergens ?? menuMeal.allergens)].filter(Boolean);
      if (allergens.length) {
        await db.recipeAllergen.createMany({
          data: allergens.map((allergenCode) => ({ recipeVersionId: version.id, allergenCode })),
        });
      }

      versionByDayMeal.set(slot, version.id);
    }
  }

  console.log(`  recipes: ${versionByDayMeal.size} (${detailed} detailed cards, ${outline} menu outlines)`);
  return versionByDayMeal;
}

async function seedCardContent(versionId: string, card: RecipeCard) {
  // Merge duplicate (ingredient, unit) pairs — the table is unique on them.
  const lines = new Map<string, { ingredientId: string; quantity: number; unit: string; note?: string }>();

  for (const item of card.ingredients) {
    const { amount, unit } = parseQuantity(item.qty);
    const normalizedName = normaliseIngredientName(item.name);

    const ingredient = await db.ingredient.upsert({
      where: { normalizedName },
      // Do NOT overwrite defaultUnit here: an ingredient already on the
      // inventory master holds its stock in a purchase unit, and recipe units
      // are converted against it (§6.2).
      update: { active: true },
      create: {
        name: item.name,
        normalizedName,
        category: "recipe",
        defaultUnit: unit,
        defaultFrequency: "weekly",
        inventoryManaged: false,
      },
      select: { id: true },
    });

    const key = `${ingredient.id}:${unit}`;
    const existing = lines.get(key);
    if (existing) existing.quantity += amount;
    else lines.set(key, { ingredientId: ingredient.id, quantity: amount, unit, note: item.note });
  }

  if (lines.size) {
    await db.recipeIngredient.createMany({
      data: [...lines.values()].map((line) => ({
        recipeVersionId: versionId,
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        unit: line.unit,
        preparationNote: line.note ?? null,
      })),
    });
  }

  const steps: Prisma.RecipeStepCreateManyInput[] = card.steps.map((step, index) => ({
    recipeVersionId: versionId,
    stepNumber: index + 1,
    title: step.title,
    instructions: [step.text, ...step.crits.map((crit) => `${crit.type.toUpperCase()}: ${crit.text}`)].join("\n"),
    // A timing control is a hard requirement; temperature and warnings are
    // controls the chef must see but that do not gate the dish (BR-3).
    criticality: step.crits.some((crit) => crit.type === "time")
      ? "mandatory"
      : step.crits.length
        ? "warning"
        : "info",
    temperatureC: extractTemperature(step.crits),
  }));

  // Advance-prep requirements become mandatory steps, which is what makes them
  // eligible for prep-task generation (BR-3).
  const advance: Prisma.RecipeStepCreateManyInput[] = card.advance.map((instructions, index) => ({
    recipeVersionId: versionId,
    stepNumber: steps.length + index + 1,
    title: "Advance preparation",
    instructions,
    criticality: "mandatory",
  }));

  if (steps.length || advance.length) {
    await db.recipeStep.createMany({ data: [...steps, ...advance] });
  }
}

/** Menu-only dishes still carry their advance-prep requirements. */
async function seedOutlineContent(versionId: string, meal: MenuMeal) {
  const steps: Prisma.RecipeStepCreateManyInput[] = meal.adv.length
    ? meal.adv.map((instructions, index) => ({
        recipeVersionId: versionId,
        stepNumber: index + 1,
        title: "Advance preparation",
        instructions,
        criticality: "mandatory",
      }))
    : [
        {
          recipeVersionId: versionId,
          stepNumber: 1,
          title: "Prepare",
          instructions: "Prepare according to the kitchen method. Detailed card pending.",
          criticality: "info",
        },
      ];

  await db.recipeStep.createMany({ data: steps });
}

function extractTemperature(crits: { type: string; text: string }[]): number | null {
  const temp = crits.find((crit) => crit.type === "temp");
  const match = temp?.text.match(/(-?\d+(?:\.\d+)?)\s*°?C/i);
  return match ? Number(match[1]) : null;
}

async function seedCycle(chefName: string, versionByDayMeal: Map<string, string>) {
  const subscriberCount = PLANS.reduce((sum, plan) => sum + plan.count, 0);

  const cycle = await db.cycle.upsert({
    where: { cycleNumber: 1 },
    update: { name: "Cycle 01", subscriberCount, foodCostTargetPercent: 30, chefName },
    create: {
      name: "Cycle 01",
      cycleNumber: 1,
      durationDays: 28,
      subscriberCount,
      foodCostTargetPercent: 30,
      chefName,
      // A start date makes advance-prep due dates computable (BR-3).
      weekStart: new Date("2026-08-03T00:00:00.000Z"),
      proteinWindowDays: 4,
      days: {
        create: menu.map((day) => ({
          dayNumber: day.day,
          weekNumber: day.week,
          phaseLabel: ["Establish", "Expand", "Refine", "Peak"][Math.min(day.week - 1, 3)],
        })),
      },
    },
  });

  const days = await db.cycleDay.findMany({ where: { cycleId: cycle.id }, select: { id: true, dayNumber: true } });
  const dayIds = new Map(days.map((day) => [day.dayNumber, day.id]));

  let assigned = 0;
  for (const day of menu) {
    const cycleDayId = dayIds.get(day.day);
    if (!cycleDayId) continue;

    for (const mealKey of MEAL_KEYS) {
      const recipeVersionId = versionByDayMeal.get(`${day.day}:${mealKey}`);
      if (!recipeVersionId) continue;

      await db.mealAssignment.upsert({
        where: { cycleDayId_mealType: { cycleDayId, mealType: MEAL_TYPES[mealKey] } },
        update: { recipeVersionId, servings: subscriberCount },
        create: { cycleDayId, mealType: MEAL_TYPES[mealKey], recipeVersionId, servings: subscriberCount },
      });
      assigned += 1;
    }
  }

  console.log(`  cycle: ${cycle.name} (${menu.length} days, ${assigned} assignments)`);
}

async function seedVesselKits(subscribers: { id: string; name: string }[]) {
  type VesselRow = { id: string; name: string; type: string; status: string; issued: string; sanit: string; sets: string; notes: string };
  const byName = new Map(subscribers.map((subscriber) => [subscriber.name, subscriber.id]));

  for (const row of vesselFixture as VesselRow[]) {
    const subscriberId = byName.get(row.name);
    if (!subscriberId) continue;

    const data = {
      type: row.type,
      status: row.status,
      sets: Number(row.sets),
      issuedAt: row.issued ? new Date(row.issued) : null,
      sanitisedAt: row.sanit ? new Date(row.sanit) : null,
      notes: row.notes || null,
    };

    const existing = await db.vesselKit.findFirst({ where: { subscriberId }, select: { id: true } });
    if (existing) await db.vesselKit.update({ where: { id: existing.id }, data });
    else await db.vesselKit.create({ data: { subscriberId, ...data } });
  }

  console.log(`  vessel kits: ${(vesselFixture as unknown[]).length}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    // Without this a failed seed exits 0 and CI reports success.
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
