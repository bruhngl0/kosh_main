import { PrismaClient, MealType, type Prisma } from "@prisma/client";
import { normaliseIngredientName } from "../../src/shared/schemas/common";
import { convert, resolveUnit } from "../../src/shared/units";

import cycleMenu from "./fixtures/cycle-menu.json";
import recipeCards from "./fixtures/recipes.json";

/**
 * Additive enrichment for the menu-outline recipes.
 *
 * Only 37 of the 112 prototype dishes came with full execution cards. The rest
 * have a title, a subtitle, nutrition, and nothing else — so they contribute no
 * demand, and purchase-order generation covers a third of the real menu.
 *
 * This fills those gaps WITHOUT touching anything that already has content:
 *   - recipe versions with zero ingredient lines get plausible ones
 *   - placeholder "Prepare" steps get a real method
 *   - ingredients with no preferred vendor get one, with pricing
 *
 * Ingredients are derived from each dish's own subtitle, which lists its
 * components ("Brown rice · raita · amaranth greens"), so the result is
 * dish-specific rather than random filler.
 *
 * Idempotent and safe to re-run: a second pass finds nothing left to fill.
 */

const db = new PrismaClient();

const MEAL_KEYS = ["bf", "sn", "lu", "di"] as const;
const MEAL_TYPES: Record<(typeof MEAL_KEYS)[number], MealType> = {
  bf: MealType.BF,
  sn: MealType.SN,
  lu: MealType.LU,
  di: MealType.DI,
};

type MenuMeal = { title: string; sub: string; protein: string; kcal: number; prot: number; adv: string[] };
type MenuDay = { day: number; week: number } & Record<(typeof MEAL_KEYS)[number], MenuMeal>;

const menu = cycleMenu as MenuDay[];
const cards = recipeCards as { day: number; meal: (typeof MEAL_KEYS)[number] }[];

/** Concrete ingredient for each protein descriptor used by the planner. */
const PROTEIN_SOURCES: Record<string, { name: string; category: string }> = {
  chicken: { name: "Chicken thigh (boneless)", category: "protein" },
  fish: { name: "Basa fillet", category: "protein" },
  salmon: { name: "Sashimi-grade salmon fillet", category: "protein" },
  prawn: { name: "Tiger prawns (16–20 count)", category: "protein" },
  shellfish: { name: "Tiger prawns (16–20 count)", category: "protein" },
  lamb: { name: "Lamb leg (boneless)", category: "protein" },
  beef: { name: "Beef sirloin", category: "protein" },
  pork: { name: "Pork loin", category: "protein" },
  egg: { name: "Eggs (free-range)", category: "dairy" },
  dairy: { name: "Greek yoghurt (full fat)", category: "dairy" },
  legume: { name: "Puy lentils", category: "grains" },
  plant: { name: "Mixed seeds and nuts", category: "pantry" },
  protein: { name: "Whey protein isolate", category: "pantry" },
};

/** Grams of the protein component, by meal slot. */
const PROTEIN_PORTION: Record<MealType, number> = { BF: 90, SN: 35, LU: 150, DI: 150 };
const SIDE_PORTION: Record<MealType, number> = { BF: 50, SN: 20, LU: 80, DI: 70 };

/** Category inference for ingredients derived from subtitle text. */
const CATEGORY_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /\b(rice|oat|quinoa|farro|freekeh|millet|roti|bread|sourdough|noodle|soba|pasta|crispbread|idli|dosa|poha|couscous|barley|bulgur)\b/i, category: "grains" },
  { pattern: /\b(oil|ghee|butter|vinegar|dressing|vinaigrette|mayo|tahini)\b/i, category: "oils" },
  { pattern: /\b(yoghurt|yogurt|cheese|paneer|feta|cream|milk|curd|raita|labneh|halloumi|ricotta|cheddar)\b/i, category: "dairy" },
  { pattern: /\b(chicken|fish|lamb|prawn|beef|pork|egg|tuna|cod|salmon|mutton|bacon|anchov)\b/i, category: "protein" },
  { pattern: /\b(miso|tamari|yuzu|bonito|dashi|harissa|zaatar|sumac|gochujang|truffle)\b/i, category: "specialty" },
  { pattern: /\b(masala|spice|powder|seed|salt|pepper|chilli|cumin|turmeric|chaat|tajín|tajin|gunpowder|granola|honey|date|cranberry|walnut|almond|pistachio|chia|flax)\b/i, category: "pantry" },
];

/**
 * Indicative INR cost per REFERENCE unit, by category: per kg for mass, per
 * litre for volume, per piece for anything counted. `costPerUnit` below scales
 * these to whatever stock unit an ingredient actually uses — pricing a
 * gram-denominated ingredient at the per-kilogram figure inflates it 1000×.
 */
const UNIT_COST: Record<string, number> = {
  protein: 620,
  dairy: 240,
  produce: 160,
  grains: 140,
  pantry: 320,
  specialty: 680,
  oils: 480,
  vessel: 200,
  recipe: 200,
};

/** Which seeded vendor supplies each category. */
const VENDOR_FOR_CATEGORY: Record<string, string> = {
  protein: "Russel Market — Meat",
  produce: "Namdhari's Fresh",
  grains: "Metro Cash & Carry",
  pantry: "Metro Cash & Carry",
  oils: "Metro Cash & Carry",
  dairy: "Le Marche / Modern Bazaar",
  specialty: "Natures Basket",
  vessel: "Vessel Supplier — Ravi Copperware",
  recipe: "Metro Cash & Carry",
};

const SEAFOOD = /\b(fish|salmon|prawn|tuna|cod|basa|shellfish)\b/i;

/** Per-piece cost for counted items, which have no mass reference. */
const PER_PIECE_COST: Record<string, number> = {
  protein: 60,
  dairy: 8,
  produce: 30,
  grains: 15,
  pantry: 25,
  specialty: 90,
  oils: 40,
  vessel: 120,
  recipe: 25,
};

/**
 * Scales a category's reference price to an ingredient's actual stock unit.
 *
 * The reference is per kg / per litre / per piece; an ingredient stocked in
 * grams must be priced per gram, or every cost projection is wrong by three
 * orders of magnitude.
 */
function costPerUnit(category: string, stockUnit: string): number {
  const reference = UNIT_COST[category] ?? 200;
  const { dimension } = resolveUnit(stockUnit);

  if (dimension === "MASS") {
    // How many kilograms is one of this unit?
    const kgPerUnit = convert(1, stockUnit, "kg") ?? 1;
    return round2(reference * kgPerUnit);
  }

  if (dimension === "VOLUME") {
    const litresPerUnit = convert(1, stockUnit, "l") ?? 1;
    return round2(reference * litresPerUnit);
  }

  // Counted or opaque units (pcs, bunch, roll): a mass price is meaningless.
  return PER_PIECE_COST[category] ?? 25;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

async function main() {
  console.log("Enriching menu-outline recipes…");

  const filled = await fillRecipeContent();
  const recategorised = await recategoriseIngredients();
  const sourced = await assignVendors();

  console.log(`\nDone. ${filled.versions} recipe version(s) filled, ${sourced} ingredient(s) sourced.`);
  console.log(`Ingredient lines added: ${filled.lines}, method steps added: ${filled.steps}`);
  console.log(`Ingredients recategorised out of "recipe": ${recategorised}`);
}

async function fillRecipeContent() {
  const detailed = new Set(cards.map((card) => `${card.day}:${card.meal}`));
  let versions = 0;
  let lines = 0;
  let steps = 0;

  for (const day of menu) {
    for (const mealKey of MEAL_KEYS) {
      if (detailed.has(`${day.day}:${mealKey}`)) continue;

      const meal = day[mealKey];
      const mealType = MEAL_TYPES[mealKey];

      const recipe = await db.recipe.findUnique({
        where: { title_mealType: { title: meal.title, mealType } },
        select: {
          id: true,
          versions: {
            orderBy: { versionNumber: "asc" },
            take: 1,
            select: { id: true, _count: { select: { ingredients: true } }, steps: true },
          },
        },
      });

      const version = recipe?.versions[0];
      // Never overwrite content that already exists.
      if (!version || version._count.ingredients > 0) continue;

      const components = deriveComponents(meal, mealType);
      const created = await writeIngredients(version.id, components);
      lines += created;
      steps += await writeMethod(version.id, version.steps, meal, mealType);
      versions += 1;
    }
  }

  return { versions, lines, steps };
}

/** Builds a plausible ingredient list from the dish's protein and subtitle. */
function deriveComponents(meal: MenuMeal, mealType: MealType) {
  const components: { name: string; category: string; grams: number }[] = [];

  const protein = PROTEIN_SOURCES[meal.protein.toLowerCase()];
  if (protein) {
    components.push({ ...protein, grams: PROTEIN_PORTION[mealType] });
  }

  // "Brown rice · raita · amaranth greens" → three components.
  for (const raw of meal.sub.split("·")) {
    const name = cleanComponent(raw);
    if (!name) continue;
    if (components.some((item) => item.name.toLowerCase() === name.toLowerCase())) continue;
    components.push({ name, category: inferCategory(name), grams: SIDE_PORTION[mealType] });
  }

  // Every dish needs a cooking fat and seasoning; the subtitles rarely mention them.
  components.push({ name: "Cold-press coconut oil", category: "oils", grams: 5 });
  components.push({ name: "Sea salt", category: "pantry", grams: 2 });

  return components;
}

function cleanComponent(raw: string): string | null {
  const name = raw
    .trim()
    // "2 crispbreads" → "crispbreads"; "Aged cheddar or paneer" → "Aged cheddar"
    .replace(/^\d+\s*/, "")
    .replace(/\s+or\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length < 3 || name.length > 60) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function inferCategory(name: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(name)) return rule.category;
  }
  return "produce";
}

/**
 * Writes ingredient lines, reusing existing master ingredients where the name
 * matches. The recipe unit is chosen to share a dimension with the ingredient's
 * stock unit, so demand aggregation never hits an unconvertible pair (§6.2).
 */
async function writeIngredients(versionId: string, components: { name: string; category: string; grams: number }[]) {
  const rows: Prisma.RecipeIngredientCreateManyInput[] = [];
  const seen = new Set<string>();

  for (const component of components) {
    const normalizedName = normaliseIngredientName(component.name);

    const ingredient = await db.ingredient.upsert({
      where: { normalizedName },
      // Existing ingredients keep their stock unit and category untouched.
      update: { active: true },
      create: {
        name: component.name,
        normalizedName,
        category: component.category,
        defaultUnit: "kg",
        defaultFrequency: "weekly",
        inventoryManaged: false,
      },
      select: { id: true, defaultUnit: true },
    });

    const { quantity, unit } = portionFor(component.grams, ingredient.defaultUnit);
    const key = `${ingredient.id}:${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ recipeVersionId: versionId, ingredientId: ingredient.id, quantity, unit });
  }

  if (rows.length) await db.recipeIngredient.createMany({ data: rows });
  return rows.length;
}

/** Expresses a gram portion in a unit compatible with the ingredient's stock unit. */
function portionFor(grams: number, stockUnit: string): { quantity: number; unit: string } {
  const dimension = resolveUnit(stockUnit).dimension;

  if (dimension === "MASS") return { quantity: grams, unit: "g" };
  if (dimension === "VOLUME") return { quantity: grams, unit: "ml" };
  if (dimension === "COUNT") return { quantity: Math.max(1, Math.round(grams / 50)), unit: "pcs" };

  // Opaque stock unit (bunch, roll…): express the portion in that same unit so
  // it stays convertible to itself.
  return { quantity: 1, unit: stockUnit };
}

/**
 * Replaces the placeholder step with a real method. Advance-prep steps carried
 * over from the planner are left alone — they drive prep-task generation.
 */
async function writeMethod(
  versionId: string,
  existing: { id: string; title: string; criticality: string; stepNumber: number }[],
  meal: MenuMeal,
  mealType: MealType,
) {
  const placeholders = existing.filter((step) => step.criticality === "info" && step.title === "Prepare");
  const advance = existing.filter((step) => step.criticality !== "info");

  // A version that already has a real method is left untouched.
  if (existing.length > 0 && placeholders.length === 0) return 0;

  await db.recipeStep.deleteMany({ where: { id: { in: placeholders.map((step) => step.id) } } });

  const method = buildMethod(meal, mealType);
  // Advance steps keep their numbers; the method slots in ahead of them.
  const offset = advance.length;

  await db.recipeStep.createMany({
    data: method.map((step, index) => ({
      recipeVersionId: versionId,
      stepNumber: offset + index + 1,
      title: step.title,
      instructions: step.instructions,
      temperatureC: step.temperatureC ?? null,
      durationMinutes: step.durationMinutes ?? null,
      criticality: "info",
    })),
  });

  return method.length;
}

function buildMethod(meal: MenuMeal, mealType: MealType) {
  const components = meal.sub.split("·").map((part) => cleanComponent(part)).filter(Boolean).join(", ");
  const isSeafood = SEAFOOD.test(meal.protein);

  const steps: { title: string; instructions: string; temperatureC?: number; durationMinutes?: number }[] = [
    {
      title: "Mise en place",
      instructions: `Weigh and prepare every component before heat goes on: ${components || "all components"}. Check seasoning levels.`,
      durationMinutes: 10,
    },
  ];

  if (mealType === "SN") {
    steps.push({
      title: "Assemble",
      instructions: "Combine components, season, and portion into the snack vessel. Cool completely before sealing — residual steam softens anything crisp.",
      durationMinutes: 8,
    });
    return steps;
  }

  steps.push({
    title: "Cook the protein",
    instructions: isSeafood
      ? "Pat dry thoroughly — surface moisture prevents a sear. Hot pan, minimal oil, skin-side down first. Do not move it until it releases."
      : "Sear on high heat to build colour, then lower and cook through. Rest before slicing so the juices redistribute.",
    temperatureC: isSeafood ? 63 : 74,
    durationMinutes: 12,
  });

  steps.push({
    title: "Build the plate",
    instructions: `Finish the accompaniments and plate: ${components || "as per the card"}. Taste and correct salt and acid at the last moment.`,
    durationMinutes: 6,
  });

  return steps;
}

/**
 * Replaces the placeholder "recipe" category.
 *
 * The prototype importer filed every ingredient it created as `recipe`, which
 * left ~95% of the master under one meaningless label and made cost-by-category
 * useless. Categories are re-derived from the ingredient name; anything already
 * on a real category is left alone.
 */
async function recategoriseIngredients() {
  const placeholder = await db.ingredient.findMany({
    where: { category: "recipe" },
    select: { id: true, name: true },
  });

  const byCategory = new Map<string, string[]>();
  for (const ingredient of placeholder) {
    const category = inferCategory(ingredient.name);
    byCategory.set(category, [...(byCategory.get(category) ?? []), ingredient.id]);
  }

  for (const [category, ids] of byCategory) {
    await db.ingredient.updateMany({ where: { id: { in: ids } }, data: { category } });
  }

  return placeholder.length;
}

/**
 * Gives every recipe ingredient a preferred vendor so it can actually be
 * ordered (BR-7). Ingredients that already have one are skipped.
 */
async function assignVendors() {
  const vendors = await db.vendor.findMany({ where: { active: true }, select: { id: true, name: true } });
  const vendorByName = new Map(vendors.map((vendor) => [vendor.name, vendor.id]));
  const fallback = vendorByName.get("Metro Cash & Carry") ?? vendors[0]?.id;
  if (!fallback) throw new Error("No vendors found — run the main seed first.");

  const unsourced = await db.ingredient.findMany({
    where: {
      active: true,
      // Only ingredients a recipe actually uses, and only those with no
      // preferred vendor already set.
      recipeIngredients: { some: {} },
      vendorIngredients: { none: { preferred: true } },
    },
    select: { id: true, name: true, category: true, defaultUnit: true },
  });

  for (const ingredient of unsourced) {
    const category = ingredient.category === "recipe" ? inferCategory(ingredient.name) : ingredient.category;
    // Seafood comes from the fish stall, not the meat stall.
    const vendorName = SEAFOOD.test(ingredient.name)
      ? "Russel Market — Fish & Seafood"
      : VENDOR_FOR_CATEGORY[category];

    const vendorId = vendorByName.get(vendorName ?? "") ?? fallback;

    const unitCost = costPerUnit(category, ingredient.defaultUnit);

    await db.vendorIngredient.upsert({
      where: { vendorId_ingredientId: { vendorId, ingredientId: ingredient.id } },
      update: { preferred: true, unitCost, unit: ingredient.defaultUnit },
      create: {
        vendorId,
        ingredientId: ingredient.id,
        preferred: true,
        unit: ingredient.defaultUnit,
        unitCost,
      },
    });
  }

  return unsourced.length;
}

main()
  .catch((error) => {
    console.error("Enrichment failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
