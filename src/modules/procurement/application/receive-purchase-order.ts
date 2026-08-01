import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { AppError, invalidTransition, notFound, unprocessable } from "@/server/errors";
import { applyMovements } from "@/modules/inventory";
import { toNumber } from "@/shared/money";
import { allowedTransitions, canTransition, isTerminal, planReceipt } from "@/modules/procurement/domain/lifecycle";
import * as repository from "@/modules/procurement/infrastructure/purchase-order-repository";
import { toPurchaseOrderView } from "@/modules/procurement/application/purchase-order-queries";
import type {
  ReceivePurchaseOrderInput,
  TransitionPurchaseOrderInput,
} from "@/shared/schemas/procurement";

type Context = { actor: Actor; requestId: string };

/**
 * BR-13 — receiving goods.
 *
 * This is the bridge between procurement and inventory that did not previously
 * exist: marking an order RECEIVED updated a timestamp and nothing else, so
 * stock never reflected anything that was actually delivered.
 *
 * Line quantities, the movements, and the order status all change in ONE
 * transaction. A partial failure must not leave stock credited for goods the
 * order does not record as received.
 */
export async function receivePurchaseOrder(
  id: string,
  input: ReceivePurchaseOrderInput,
  context: Context,
) {
  assertCan(context.actor, "procurement:write");

  return db.$transaction(async (tx) => {
    const order = await repository.findPurchaseOrder(tx, id);
    if (!order) throw notFound("Purchase order", id);

    if (isTerminal(order.status)) {
      throw unprocessable(`This order is already ${order.status.toLowerCase().replace("_", " ")}.`, {
        status: order.status,
      });
    }

    const outcome = planReceipt(
      order.lines.map((line) => ({
        lineId: line.id,
        ingredientId: line.ingredientId,
        requestedQty: toNumber(line.requestedQty),
        receivedQty: toNumber(line.receivedQty),
        unit: line.unit,
      })),
      input.lines.map((line) => ({
        lineId: line.lineId,
        ingredientId: "",
        receivedQty: line.receivedQty,
      })),
    );

    if (!outcome.ok) throw receiptRejectionToError(outcome.rejection);

    const { plan } = outcome;
    const costByLine = new Map(input.lines.map((line) => [line.lineId, line.unitCost]));
    const received = plan.lines.filter((line) => line.appliedQty > 0);

    for (const line of received) {
      await repository.updateLine(tx, line.lineId, { receivedQty: line.totalReceivedQty });
    }

    // Reuses the inventory module's stock rules — units are converted from the
    // purchase unit to the stock unit inside applyMovements (§6.2).
    const movements = await applyMovements(
      tx,
      received.map((line) => {
        const original = order.lines.find((item) => item.id === line.lineId);
        const unitCost = costByLine.get(line.lineId) ?? toNumber(original?.unitCost);
        return {
          ingredientId: line.ingredientId,
          type: "RECEIVE" as const,
          quantity: line.appliedQty,
          unit: line.unit,
          unitCost: unitCost || undefined,
          reference: input.reference ?? `PO ${order.id}`,
        };
      }),
      context.actor.id,
    );

    const updated = await repository.updatePurchaseOrder(tx, id, {
      status: plan.nextStatus,
      receivedAt: plan.fullyReceived ? new Date() : null,
      ...(order.orderedAt ? {} : { orderedAt: new Date() }),
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "purchase_order.received",
      entityType: "PurchaseOrder",
      entityId: id,
      before: { status: order.status },
      after: {
        status: plan.nextStatus,
        fullyReceived: plan.fullyReceived,
        movementIds: movements.map((movement) => movement.id),
      },
      requestId: context.requestId,
    });

    return {
      order: toPurchaseOrderView(updated),
      movements: movements.map((movement) => ({
        id: movement.id,
        ingredientId: movement.ingredientId,
        quantityDelta: toNumber(movement.quantityDelta),
        balanceAfter: toNumber(movement.balanceAfter),
        unit: movement.unit,
      })),
      fullyReceived: plan.fullyReceived,
    };
  });
}

/** BR-12 — status changes that are not receipts. */
export async function transitionPurchaseOrder(
  id: string,
  input: TransitionPurchaseOrderInput,
  context: Context,
) {
  assertCan(context.actor, "procurement:write");

  return db.$transaction(async (tx) => {
    const order = await repository.findPurchaseOrder(tx, id);
    if (!order) throw notFound("Purchase order", id);

    if (order.status === input.status) return toPurchaseOrderView(order);

    if (!canTransition(order.status, input.status)) {
      throw invalidTransition("Purchase order", order.status, input.status, allowedTransitions(order.status));
    }

    // Receiving must go through receivePurchaseOrder so stock is written.
    if (input.status === "RECEIVED" || input.status === "PARTIALLY_RECEIVED") {
      throw unprocessable(
        "Record receipt with the receive endpoint so stock movements are created.",
        { endpoint: `/api/v1/purchase-orders/${id}/receive` },
      );
    }

    const updated = await repository.updatePurchaseOrder(tx, id, {
      status: input.status,
      notes: input.notes,
      ...(input.status === "ORDERED" ? { orderedAt: new Date() } : {}),
    });

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "purchase_order.status_changed",
      entityType: "PurchaseOrder",
      entityId: id,
      before: { status: order.status },
      after: { status: input.status },
      requestId: context.requestId,
    });

    return toPurchaseOrderView(updated);
  });
}

function receiptRejectionToError(
  rejection: Extract<ReturnType<typeof planReceipt>, { ok: false }>["rejection"],
): AppError {
  switch (rejection.kind) {
    case "UNKNOWN_LINE":
      return new AppError("VALIDATION_ERROR", "A received line does not belong to this purchase order.", {
        details: { lineId: rejection.lineId },
      });
    case "NEGATIVE_QUANTITY":
      return new AppError("VALIDATION_ERROR", "Received quantity cannot be negative.", {
        details: { lineId: rejection.lineId },
      });
    case "NOTHING_RECEIVED":
      return unprocessable("Record a quantity greater than zero for at least one line.");
  }
}
