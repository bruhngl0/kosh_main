import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { conflict, notFound } from "@/server/errors";
import { toNullableNumber } from "@/shared/money";
import { whatsappLink } from "@/modules/procurement/domain/outreach";
import * as inventoryRepository from "@/modules/inventory/infrastructure/ingredient-repository";
import type {
  CreateVendorInput,
  LinkVendorIngredientInput,
  UpdateVendorInput,
} from "@/shared/schemas/procurement";

type Context = { actor: Actor; requestId: string };

export async function createVendor(input: CreateVendorInput, context: Context) {
  assertCan(context.actor, "procurement:write");

  const existing = await db.vendor.findUnique({ where: { name: input.name }, select: { id: true } });
  if (existing) {
    throw conflict(`A vendor called "${input.name}" already exists.`, { vendorId: existing.id });
  }

  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.create({ data: input });
    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "vendor.created",
      entityType: "Vendor",
      entityId: vendor.id,
      after: vendor,
      requestId: context.requestId,
    });
    return toVendorView({ ...vendor, _count: { ingredients: 0, purchaseOrders: 0 } });
  });
}

export async function updateVendor(id: string, input: UpdateVendorInput, context: Context) {
  assertCan(context.actor, "procurement:write");

  const before = await db.vendor.findUnique({ where: { id } });
  if (!before) throw notFound("Vendor", id);

  return db.$transaction(async (tx) => {
    const after = await tx.vendor.update({
      where: { id },
      data: input,
      include: { _count: { select: { ingredients: true, purchaseOrders: true } } },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: input.active === false ? "vendor.deactivated" : "vendor.updated",
      entityType: "Vendor",
      entityId: id,
      before,
      after,
      requestId: context.requestId,
    });

    return toVendorView(after);
  });
}

/**
 * Sets a vendor's price and preferred flag for one ingredient.
 *
 * Preference is exclusive: marking a vendor preferred clears the flag on every
 * other vendor for that ingredient, so BR-7 grouping always has exactly one
 * answer.
 */
export async function linkVendorIngredient(
  vendorId: string,
  ingredientId: string,
  input: LinkVendorIngredientInput,
  context: Context,
) {
  assertCan(context.actor, "procurement:write");

  const [vendor, ingredient] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } }),
    db.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true, name: true } }),
  ]);
  if (!vendor) throw notFound("Vendor", vendorId);
  if (!ingredient) throw notFound("Ingredient", ingredientId);

  return db.$transaction(async (tx) => {
    if (input.preferred) {
      await inventoryRepository.clearPreferredVendors(tx, ingredientId, vendorId);
    }

    const link = await inventoryRepository.upsertVendorIngredient(tx, {
      vendorId,
      ingredientId,
      unitCost: input.unitCost,
      unit: input.unit,
      minimumQty: input.minimumQty,
      preferred: input.preferred,
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "vendor_ingredient.linked",
      entityType: "VendorIngredient",
      entityId: link.id,
      after: { vendorId, ingredientId, ...input },
      requestId: context.requestId,
    });

    return {
      id: link.id,
      vendorId,
      vendorName: vendor.name,
      ingredientId,
      ingredientName: ingredient.name,
      unitCost: toNullableNumber(link.unitCost),
      unit: link.unit,
      minimumQty: toNullableNumber(link.minimumQty),
      preferred: link.preferred,
    };
  });
}

export async function listVendors(filter: { includeInactive?: boolean } = {}) {
  const vendors = await db.vendor.findMany({
    where: filter.includeInactive ? {} : { active: true },
    include: { _count: { select: { ingredients: true, purchaseOrders: true } } },
    orderBy: { name: "asc" },
  });
  return vendors.map(toVendorView);
}

export async function getVendor(id: string) {
  const vendor = await db.vendor.findUnique({
    where: { id },
    include: {
      _count: { select: { ingredients: true, purchaseOrders: true } },
      ingredients: {
        include: { ingredient: { select: { id: true, name: true, category: true, defaultUnit: true } } },
        orderBy: { ingredient: { name: "asc" } },
      },
    },
  });
  if (!vendor) throw notFound("Vendor", id);

  return {
    ...toVendorView(vendor),
    ingredients: vendor.ingredients.map((link) => ({
      ingredientId: link.ingredientId,
      name: link.ingredient.name,
      category: link.ingredient.category,
      unitCost: toNullableNumber(link.unitCost),
      unit: link.unit ?? link.ingredient.defaultUnit,
      minimumQty: toNullableNumber(link.minimumQty),
      preferred: link.preferred,
    })),
  };
}

type VendorRow = {
  id: string;
  name: string;
  category: string | null;
  contact: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  minimumOrder: string | null;
  leadTime: string | null;
  cutoff: string | null;
  area: string | null;
  paymentTerms: string | null;
  notes: string | null;
  active: boolean;
  _count: { ingredients: number; purchaseOrders: number };
};

function toVendorView(vendor: VendorRow) {
  return {
    id: vendor.id,
    name: vendor.name,
    category: vendor.category,
    contact: vendor.contact,
    whatsapp: vendor.whatsapp,
    phone: vendor.phone,
    email: vendor.email,
    minimumOrder: vendor.minimumOrder,
    leadTime: vendor.leadTime,
    cutoff: vendor.cutoff,
    area: vendor.area,
    paymentTerms: vendor.paymentTerms,
    notes: vendor.notes,
    active: vendor.active,
    // Ready-made link so the UI does not re-implement number cleaning.
    whatsappUrl: whatsappLink(vendor.whatsapp),
    counts: vendor._count,
  };
}
