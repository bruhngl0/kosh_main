import { execSync } from "node:child_process";
import { beforeAll } from "vitest";
import { db } from "@/server/db";

/**
 * Integration test bootstrap.
 *
 * Runs migrations once against the configured database, then each test file
 * builds the fixtures it needs. Tests run serially (see
 * vitest.integration.config.ts) because they truncate shared tables.
 *
 * Point DATABASE_URL at a scratch database — this WILL destroy data.
 */

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run integration tests.");
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  });
});

/**
 * Order matters: children before parents, because operational records use
 * RESTRICT deletes on purpose (§5.1).
 */
export async function resetDatabase() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_events, run_sheet_checks, run_sheet_tasks, vessel_dispatches, run_sheets,
      cash_transactions, recurring_costs, cash_opening_balances,
      inventory_movements, inventory_balances,
      purchase_order_lines, purchase_orders,
      prep_tasks, meal_assignments, cycle_days, cycles,
      recipe_allergens, recipe_steps, recipe_ingredients, recipe_versions, recipes,
      vendor_ingredients, vendors, ingredients,
      vessel_kits, subscribers, subscription_plans,
      users
    RESTART IDENTITY CASCADE
  `);
}

/** The actor every use case runs as. */
export async function seedActor(role: "ADMIN" | "PLANNER" | "KITCHEN" | "PROCUREMENT" | "VIEWER" = "ADMIN") {
  return db.user.upsert({
    where: { email: "admin@kosh.local" },
    update: { role },
    create: { name: "Test Operations", email: "admin@kosh.local", role },
  });
}

export { db };
