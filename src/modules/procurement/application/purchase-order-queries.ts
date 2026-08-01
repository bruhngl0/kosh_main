import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { toDateString, toNullableNumber, toNumber } from "@/shared/money";
import { allowedTransitions } from "@/modules/procurement/domain/lifecycle";
import { buildOutreachMessage } from "@/modules/procurement/domain/outreach";
import * as repository from "@/modules/procurement/infrastructure/purchase-order-repository";

export function toPurchaseOrderView(order: repository.PurchaseOrderWithLines) {
  const lines = order.lines.map((line) => {
    const requestedQty = toNumber(line.requestedQty);
    const receivedQty = toNumber(line.receivedQty);
    const unitCost = toNullableNumber(line.unitCost);
    return {
      id: line.id,
      ingredientId: line.ingredientId,
      ingredientName: line.ingredient.name,
      ingredientNotes: line.ingredient.notes,
      requestedQty,
      orderedQty: toNumber(line.orderedQty),
      receivedQty,
      outstandingQty: Math.max(0, Math.round((requestedQty - receivedQty) * 1000) / 1000),
      unit: line.unit,
      unitCost,
      lineCost: unitCost === null ? null : Math.round(requestedQty * unitCost * 100) / 100,
      notes: line.notes,
    };
  });

  return {
    id: order.id,
    status: order.status,
    weekNumber: order.weekNumber,
    notes: order.notes,
    orderedAt: order.orderedAt?.toISOString() ?? null,
    receivedAt: order.receivedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    allowedTransitions: allowedTransitions(order.status),
    vendor: {
      id: order.vendor.id,
      name: order.vendor.name,
      contact: order.vendor.contact,
      whatsapp: order.vendor.whatsapp,
      phone: order.vendor.phone,
      leadTime: order.vendor.leadTime,
      cutoff: order.vendor.cutoff,
      minimumOrder: order.vendor.minimumOrder,
    },
    cycle: order.cycle ? { id: order.cycle.id, name: order.cycle.name, cycleNumber: order.cycle.cycleNumber } : null,
    lines,
    lineCount: lines.length,
    estimatedCost: Math.round(lines.reduce((sum, line) => sum + (line.lineCost ?? 0), 0) * 100) / 100,
  };
}

export async function listPurchaseOrders(filter: repository.PurchaseOrderFilter = {}) {
  const orders = await repository.listPurchaseOrders(db, filter);
  return orders.map(toPurchaseOrderView);
}

export async function getPurchaseOrder(id: string) {
  const order = await repository.findPurchaseOrder(db, id);
  if (!order) throw notFound("Purchase order", id);
  return toPurchaseOrderView(order);
}

/**
 * Vendor outreach message, restored to the full prototype template with a
 * WhatsApp deep link (Kosh_Inventory.html:797).
 */
export async function getOutreach(id: string) {
  const order = await repository.findPurchaseOrder(db, id);
  if (!order) throw notFound("Purchase order", id);

  const weekStart = order.cycle?.weekStart ?? null;
  const weekLabel = weekStart
    ? weekStart.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : null;

  const message = buildOutreachMessage({
    vendorName: order.vendor.name,
    contactName: order.vendor.contact,
    whatsapp: order.vendor.whatsapp,
    chefName: order.cycle?.chefName ?? null,
    weekLabel,
    cycleLabel: order.weekNumber ? `${order.cycle?.name ?? "Cycle"} · Week ${order.weekNumber}` : order.cycle?.name ?? null,
    subscriberCount: order.cycle?.subscriberCount ?? 0,
    lines: order.lines.map((line) => ({
      ingredientName: line.ingredient.name,
      quantity: toNumber(line.requestedQty),
      unit: line.unit,
      notes: line.ingredient.notes,
    })),
  });

  return {
    purchaseOrderId: order.id,
    status: order.status,
    weekStart: toDateString(weekStart),
    ...message,
  };
}
