import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/db";

/** Purchase order persistence. */

const orderInclude = {
  vendor: true,
  cycle: { select: { id: true, name: true, cycleNumber: true, chefName: true, subscriberCount: true, weekStart: true } },
  lines: {
    include: { ingredient: { select: { id: true, name: true, notes: true, defaultUnit: true } } },
    orderBy: { ingredient: { name: "asc" } },
  },
} satisfies Prisma.PurchaseOrderInclude;

export type PurchaseOrderWithLines = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

export type PurchaseOrderFilter = {
  cycleId?: string;
  vendorId?: string;
  weekNumber?: number;
  status?: string;
  openOnly?: boolean;
};

export function listPurchaseOrders(client: DbClient, filter: PurchaseOrderFilter = {}) {
  return client.purchaseOrder.findMany({
    where: {
      ...(filter.cycleId ? { cycleId: filter.cycleId } : {}),
      ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter.weekNumber ? { weekNumber: filter.weekNumber } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.openOnly ? { status: { notIn: ["RECEIVED", "CANCELLED"] } } : {}),
    },
    include: orderInclude,
    orderBy: [{ createdAt: "desc" }],
  });
}

export function findPurchaseOrder(client: DbClient, id: string) {
  return client.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
}

/** BR-16 — the natural key regeneration reconciles against. */
export function findGeneratedOrder(
  client: DbClient,
  key: { cycleId: string; vendorId: string; weekNumber: number },
) {
  return client.purchaseOrder.findUnique({
    where: {
      cycleId_vendorId_weekNumber: {
        cycleId: key.cycleId,
        vendorId: key.vendorId,
        weekNumber: key.weekNumber,
      },
    },
    include: orderInclude,
  });
}

export function createPurchaseOrder(client: DbClient, data: Prisma.PurchaseOrderUncheckedCreateInput) {
  return client.purchaseOrder.create({ data, include: orderInclude });
}

export function updatePurchaseOrder(client: DbClient, id: string, data: Prisma.PurchaseOrderUpdateInput) {
  return client.purchaseOrder.update({ where: { id }, data, include: orderInclude });
}

/** Replaces every line on an order. Used by regeneration only. */
export function replaceLines(
  client: DbClient,
  orderId: string,
  lines: { ingredientId: string; requestedQty: number; unit: string; unitCost?: number }[],
) {
  return client.purchaseOrder.update({
    where: { id: orderId },
    data: { lines: { deleteMany: {}, create: lines } },
    include: orderInclude,
  });
}

export function updateLine(client: DbClient, id: string, data: Prisma.PurchaseOrderLineUpdateInput) {
  return client.purchaseOrderLine.update({ where: { id }, data });
}

/** Orders generated for a cycle week that no longer have any demand. */
export function findStaleGeneratedOrders(
  client: DbClient,
  key: { cycleId: string; weekNumber: number; keepVendorIds: string[] },
) {
  return client.purchaseOrder.findMany({
    where: {
      cycleId: key.cycleId,
      weekNumber: key.weekNumber,
      vendorId: { notIn: key.keepVendorIds },
      // Never touch an order somebody has already acted on (BR-16).
      status: { in: ["DRAFT", "OUTREACH_READY"] },
    },
    select: { id: true, vendorId: true },
  });
}

export function deletePurchaseOrders(client: DbClient, ids: string[]) {
  return client.purchaseOrder.deleteMany({ where: { id: { in: ids } } });
}
