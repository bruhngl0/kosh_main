import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { conflict, notFound } from "@/server/errors";
import * as repository from "@/modules/procurement/infrastructure/purchase-order-repository";
import { toPurchaseOrderView } from "@/modules/procurement/application/purchase-order-queries";
import type { CreatePurchaseOrderInput } from "@/shared/schemas/procurement";

type Context = { actor: Actor; requestId: string };

/**
 * Manual purchase order, for the ad-hoc buying that does not come from a cycle
 * week — a vendor runs out, or somebody needs vessel consumables.
 */
export async function createPurchaseOrder(input: CreatePurchaseOrderInput, context: Context) {
  assertCan(context.actor, "procurement:write");

  const vendor = await db.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true, name: true } });
  if (!vendor) throw notFound("Vendor", input.vendorId);

  const ingredientIds = [...new Set(input.lines.map((line) => line.ingredientId))];
  const found = await db.ingredient.count({ where: { id: { in: ingredientIds } } });
  if (found !== ingredientIds.length) {
    throw notFound("One or more ingredients on this order");
  }

  // Guard the generation key (BR-16): a manual order for a cycle week would
  // otherwise collide with a generated one on the unique constraint.
  if (input.cycleId && input.weekNumber) {
    const existing = await repository.findGeneratedOrder(db, {
      cycleId: input.cycleId,
      vendorId: input.vendorId,
      weekNumber: input.weekNumber,
    });
    if (existing) {
      throw conflict(
        `${vendor.name} already has an order for week ${input.weekNumber} of this cycle.`,
        { purchaseOrderId: existing.id, status: existing.status },
      );
    }
  }

  // Merge duplicate lines: the table is unique on (order, ingredient).
  const merged = new Map<string, { ingredientId: string; requestedQty: number; unit: string; unitCost?: number; notes?: string }>();
  for (const line of input.lines) {
    const existing = merged.get(line.ingredientId);
    if (existing) {
      existing.requestedQty += line.requestedQty;
    } else {
      merged.set(line.ingredientId, { ...line });
    }
  }

  return db.$transaction(async (tx) => {
    const order = await repository.createPurchaseOrder(tx, {
      vendorId: input.vendorId,
      cycleId: input.cycleId,
      weekNumber: input.weekNumber,
      notes: input.notes,
      status: "DRAFT",
      lines: { create: [...merged.values()] },
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "purchase_order.created",
      entityType: "PurchaseOrder",
      entityId: order.id,
      after: { vendorId: input.vendorId, lineCount: merged.size },
      requestId: context.requestId,
    });

    return toPurchaseOrderView(order);
  });
}
