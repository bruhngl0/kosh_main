import { Prisma, type DbClient } from "@/server/db";

/** Ingredient, balance, and movement persistence. */

const ingredientInclude = {
  balance: true,
  vendorIngredients: {
    where: { preferred: true },
    include: { vendor: { select: { id: true, name: true, whatsapp: true, contact: true } } },
    take: 1,
  },
} satisfies Prisma.IngredientInclude;

export type IngredientWithContext = Prisma.IngredientGetPayload<{ include: typeof ingredientInclude }>;

export type IngredientFilter = {
  search?: string;
  category?: string;
  frequency?: string;
  status?: string;
  managedOnly?: boolean;
  includeArchived?: boolean;
};

function buildWhere(filter: IngredientFilter): Prisma.IngredientWhereInput {
  return {
    ...(filter.includeArchived ? {} : { active: true }),
    ...(filter.managedOnly ? { inventoryManaged: true } : {}),
    ...(filter.category && filter.category !== "all" ? { category: filter.category } : {}),
    ...(filter.frequency ? { defaultFrequency: filter.frequency } : {}),
    ...(filter.status ? { inventoryStatus: filter.status } : {}),
    ...(filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: "insensitive" } },
            { notes: { contains: filter.search, mode: "insensitive" } },
            { vendorIngredients: { some: { vendor: { name: { contains: filter.search, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
}

export function listIngredients(client: DbClient, filter: IngredientFilter = {}) {
  return client.ingredient.findMany({
    where: buildWhere(filter),
    include: ingredientInclude,
    orderBy: { name: "asc" },
  });
}

export function findIngredientById(client: DbClient, id: string) {
  return client.ingredient.findUnique({ where: { id }, include: ingredientInclude });
}

export function findIngredientByNormalisedName(client: DbClient, normalizedName: string) {
  return client.ingredient.findUnique({ where: { normalizedName }, include: ingredientInclude });
}

export function findIngredientsByIds(client: DbClient, ids: string[]) {
  return client.ingredient.findMany({ where: { id: { in: ids } }, include: ingredientInclude });
}

export function createIngredient(client: DbClient, data: Prisma.IngredientCreateInput) {
  return client.ingredient.create({ data, include: ingredientInclude });
}

export function updateIngredient(client: DbClient, id: string, data: Prisma.IngredientUpdateInput) {
  return client.ingredient.update({ where: { id }, data, include: ingredientInclude });
}

export function archiveIngredient(client: DbClient, id: string) {
  return client.ingredient.update({ where: { id }, data: { active: false } });
}

// ── Balances ─────────────────────────────────────────────────────────────────

export function findBalance(client: DbClient, ingredientId: string) {
  return client.inventoryBalance.findUnique({ where: { ingredientId } });
}

/**
 * Locks the balance row for the duration of the transaction.
 *
 * BR-10 needs read-then-write to be atomic: without the lock, two concurrent
 * CONSUME movements can each read the same balance, each decide there is enough
 * stock, and both commit — driving the balance negative without an override.
 */
export async function lockBalanceForUpdate(
  client: DbClient,
  ingredientId: string,
): Promise<{ id: string; quantity: string } | null> {
  const rows = await lockBalancesForUpdate(client, [ingredientId]);
  return rows.get(ingredientId) ?? null;
}

/**
 * Locks several balance rows in one round trip.
 *
 * `ORDER BY ingredient_id` is not cosmetic: two concurrent transactions that
 * lock the same rows in different orders will deadlock. A deterministic order
 * means they queue instead.
 */
export async function lockBalancesForUpdate(
  client: DbClient,
  ingredientIds: string[],
): Promise<Map<string, { id: string; quantity: string }>> {
  if (!ingredientIds.length) return new Map();

  const rows = await client.$queryRaw<{ id: string; ingredient_id: string; quantity: string }[]>`
    SELECT id, ingredient_id, quantity::text AS quantity
    FROM inventory_balances
    WHERE ingredient_id = ANY(${ingredientIds}::uuid[])
    ORDER BY ingredient_id
    FOR UPDATE
  `;

  return new Map(rows.map((row) => [row.ingredient_id, { id: row.id, quantity: row.quantity }]));
}

/** Writes many balances in one statement. */
export async function upsertBalances(
  client: DbClient,
  balances: { ingredientId: string; quantity: number }[],
) {
  if (!balances.length) return;

  const values = balances.map(
    (balance) => Prisma.sql`(gen_random_uuid(), ${balance.ingredientId}::uuid, ${balance.quantity}, NOW())`,
  );

  await client.$executeRaw`
    INSERT INTO inventory_balances (id, ingredient_id, quantity, updated_at)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (ingredient_id) DO UPDATE SET
      quantity   = EXCLUDED.quantity,
      updated_at = NOW()
  `;
}

export function upsertBalance(
  client: DbClient,
  input: { ingredientId: string; quantity?: number; parLevel?: number; reorderPoint?: number },
) {
  const { ingredientId, ...values } = input;
  return client.inventoryBalance.upsert({
    where: { ingredientId },
    create: {
      ingredientId,
      quantity: values.quantity ?? 0,
      parLevel: values.parLevel ?? 0,
      reorderPoint: values.reorderPoint ?? values.parLevel ?? 0,
    },
    update: {
      ...(values.quantity === undefined ? {} : { quantity: values.quantity }),
      ...(values.parLevel === undefined ? {} : { parLevel: values.parLevel }),
      ...(values.reorderPoint === undefined ? {} : { reorderPoint: values.reorderPoint }),
    },
  });
}

// ── Movements ────────────────────────────────────────────────────────────────

export function createMovement(client: DbClient, data: Prisma.InventoryMovementUncheckedCreateInput) {
  return client.inventoryMovement.create({ data });
}

export function createMovements(client: DbClient, data: Prisma.InventoryMovementUncheckedCreateInput[]) {
  return client.inventoryMovement.createMany({ data });
}

export function listMovements(
  client: DbClient,
  filter: { ingredientId?: string; type?: string; limit: number },
) {
  return client.inventoryMovement.findMany({
    where: {
      ...(filter.ingredientId ? { ingredientId: filter.ingredientId } : {}),
      ...(filter.type ? { type: filter.type as never } : {}),
    },
    include: {
      ingredient: { select: { id: true, name: true, defaultUnit: true } },
      actor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filter.limit,
  });
}

// ── Vendor links ─────────────────────────────────────────────────────────────

export function upsertVendorIngredient(
  client: DbClient,
  input: {
    vendorId: string;
    ingredientId: string;
    unitCost?: number;
    unit?: string;
    minimumQty?: number;
    preferred: boolean;
  },
) {
  const { vendorId, ingredientId, ...values } = input;
  return client.vendorIngredient.upsert({
    where: { vendorId_ingredientId: { vendorId, ingredientId } },
    create: { vendorId, ingredientId, ...values },
    update: values,
  });
}

/** Only one vendor may be preferred per ingredient. */
export function clearPreferredVendors(client: DbClient, ingredientId: string, exceptVendorId?: string) {
  return client.vendorIngredient.updateMany({
    where: { ingredientId, ...(exceptVendorId ? { vendorId: { not: exceptVendorId } } : {}) },
    data: { preferred: false },
  });
}
