/**
 * BR-29 — matching subscribers' allergies against the day's dishes.
 *
 * The two sides speak different languages. Recipes carry the kitchen's
 * allergen codes ("Tree nuts", "Gluten (roti)", "Crustacean (paste)"), while
 * subscribers type whatever they call it on the onboarding form ("peanuts",
 * "prawns", "lactose intolerant", "nuts"). Both are reduced to a canonical
 * group before comparing.
 *
 * The failure that matters is a missed clash, so matching errs wide: "nuts"
 * clashes with tree nuts and groundnuts, "shellfish" with crustaceans and
 * molluscs. An allergy that maps to no known group is never silently dropped:
 * it is reported as unrecognised so a person checks it by hand.
 *
 * Pure: no I/O.
 */

export const ALLERGEN_GROUPS = [
  "Gluten",
  "Dairy",
  "Egg",
  "Tree nuts",
  "Groundnuts",
  "Soya",
  "Fish",
  "Crustacean",
  "Mollusc",
  "Sesame",
  "Mustard",
  "Sulphites",
  "Legumes",
  "Coconut",
  "Pork",
  "Celery",
  "Lupin",
] as const;
export type AllergenGroup = (typeof ALLERGEN_GROUPS)[number];

/**
 * Word stems → groups, matched at the start of a word of the normalised text,
 * so "almonds" hits "almond" and "lentils" hits "lentil". A trailing `$` makes
 * a stem whole-word only, for short stems that would otherwise hit unrelated
 * words ("egg" in "eggplant", "til" in "tilapia").
 */
const SYNONYMS: [string, AllergenGroup[]][] = [
  ["gluten", ["Gluten"]], ["wheat", ["Gluten"]], ["atta$", ["Gluten"]], ["maida", ["Gluten"]], ["barley", ["Gluten"]],
  ["rye$", ["Gluten"]], ["semolina", ["Gluten"]], ["sooji", ["Gluten"]], ["rava$", ["Gluten"]], ["roti", ["Gluten"]],
  ["coeliac", ["Gluten"]], ["celiac", ["Gluten"]], ["oats?$", ["Gluten"]],
  ["dairy", ["Dairy"]], ["milk", ["Dairy"]], ["lactose", ["Dairy"]], ["cheese", ["Dairy"]], ["paneer", ["Dairy"]],
  ["curd", ["Dairy"]], ["yogh?urt", ["Dairy"]], ["butter$", ["Dairy"]], ["ghee", ["Dairy"]],
  ["cream", ["Dairy"]], ["whey", ["Dairy"]], ["casein", ["Dairy"]],
  ["eggs?$", ["Egg"]],
  ["tree nut", ["Tree nuts"]], ["almond", ["Tree nuts"]], ["cashew", ["Tree nuts"]], ["walnut", ["Tree nuts"]],
  ["pistachio", ["Tree nuts"]], ["hazelnut", ["Tree nuts"]], ["pecan", ["Tree nuts"]], ["macadamia", ["Tree nuts"]],
  ["brazil nut", ["Tree nuts"]], ["pine nut", ["Tree nuts"]],
  ["peanut", ["Groundnuts"]], ["groundnut", ["Groundnuts"]], ["moongphali", ["Groundnuts"]],
  // A bare "nut"/"nuts" is ambiguous, so it covers both kinds.
  ["(?<!tree |pine |brazil )nuts?$", ["Tree nuts", "Groundnuts"]],
  ["soy", ["Soya"]], ["tofu", ["Soya"]], ["tamari", ["Soya", "Gluten"]], ["edamame", ["Soya"]],
  ["fish", ["Fish"]], ["salmon", ["Fish"]], ["tuna$", ["Fish"]], ["cod$", ["Fish"]], ["anchov", ["Fish"]], ["seer$", ["Fish"]], ["tilapia", ["Fish"]], ["mackerel", ["Fish"]], ["sardine", ["Fish"]], ["pomfret", ["Fish"]],
  ["seafood", ["Fish", "Crustacean", "Mollusc"]],
  ["shellfish", ["Crustacean", "Mollusc"]],
  ["crustacean", ["Crustacean"]], ["prawn", ["Crustacean"]], ["shrimp", ["Crustacean"]], ["crabs?$", ["Crustacean"]],
  ["lobster", ["Crustacean"]],
  ["mollus[ck]", ["Mollusc"]], ["squid", ["Mollusc"]], ["oyster", ["Mollusc"]], ["mussel", ["Mollusc"]],
  ["clams?$", ["Mollusc"]], ["octopus", ["Mollusc"]],
  ["sesame", ["Sesame"]], ["til$", ["Sesame"]], ["tahini", ["Sesame"]],
  ["mustard", ["Mustard"]],
  ["sul[pf]hite", ["Sulphites"]], ["wine", ["Sulphites"]],
  ["legume", ["Legumes"]], ["lentil", ["Legumes"]], ["d[a]{1,2}ls?$", ["Legumes"]], ["chickpea", ["Legumes"]],
  ["chana", ["Legumes"]], ["rajma", ["Legumes"]], ["pulses?$", ["Legumes"]], ["beans?$", ["Legumes"]], ["peas?$", ["Legumes"]],
  ["coconut", ["Coconut"]],
  ["pork", ["Pork"]], ["bacon", ["Pork"]], ["ham$", ["Pork"]],
  ["celery", ["Celery"]],
  ["lupin", ["Lupin"]],
];

const PATTERNS = SYNONYMS.map(([stem, groups]) => ({
  pattern: new RegExp(`(?:^| )${stem.endsWith("$") ? `${stem.slice(0, -1)}(?= |$)` : stem}`),
  groups,
}));

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "Gluten (roti)" → "gluten"
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Every canonical group a piece of free text refers to. Empty when unrecognised. */
export function allergenGroups(text: string): AllergenGroup[] {
  const words = normalise(text);
  if (!words) return [];
  const found = new Set<AllergenGroup>();
  for (const { pattern, groups } of PATTERNS) {
    if (pattern.test(words)) groups.forEach((group) => found.add(group));
  }
  return ALLERGEN_GROUPS.filter((group) => found.has(group));
}

export type DishAllergens = { mealType: string; title: string; allergens: string[] };

export type AllergenClash = {
  mealType: string;
  dish: string;
  /** What the subscriber wrote. */
  allergy: string;
  /** The recipe's allergen code it collided with. */
  allergen: string;
};

/**
 * Clashes for one subscriber against the day's dishes, plus any allergy we
 * could not interpret and so could not check.
 */
export function findClashes(allergies: string[], dishes: DishAllergens[]) {
  const clashes: AllergenClash[] = [];
  const unrecognised: string[] = [];

  for (const allergy of allergies) {
    const wanted = allergenGroups(allergy);
    if (!wanted.length) {
      unrecognised.push(allergy);
      continue;
    }
    for (const dish of dishes) {
      for (const code of dish.allergens) {
        if (allergenGroups(code).some((group) => wanted.includes(group))) {
          clashes.push({ mealType: dish.mealType, dish: dish.title, allergy, allergen: code });
        }
      }
    }
  }

  return { clashes, unrecognised };
}
