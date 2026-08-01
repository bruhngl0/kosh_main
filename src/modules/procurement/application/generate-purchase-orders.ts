import { db } from "@/server/db";
import { assertCan, type Actor } from "@/server/actor";
import { recordAudit } from "@/server/audit";
import { notFound, unprocessable } from "@/server/errors";
import { getWeekDemandInputs } from "@/modules/cycles";
import { getIngredientContexts } from "@/modules/inventory";
import { aggregateDemand, buildPurchasePlan } from "@/modules/procurement/domain/demand";
import { isRegenerable } from "@/modules/procurement/domain/lifecycle";
import * as repository from "@/modules/procurement/infrastructure/purchase-order-repository";
import type { GeneratePurchaseOrderInput } from "@/shared/schemas/procurement";
import { toPurchaseOrderView } from "@/modules/procurement/application/purchase-order-queries";

/**
 * BR-6, BR-7, BR-16 — generate purchase requirements for a cycle week.
 *
 * Idempotent by construction: orders are keyed on (cycleId, vendorId,
 * weekNumber), so re-running reconciles rather than duplicating. Orders that
 * have already been sent to a vendor are never rewritten — the chef would have
 * no way to know the numbers changed after they placed the order.
 */

type Context = { actor: Actor; requestId: string };

export async function generatePurchaseOrders(input: GeneratePurchaseOrderInput, context: Context) {
  assertCan(context.actor, "procurement:write");

  const cycle = await db.cycle.findUnique({
    where: { id: input.cycleId },
    select: { id: true, name: true, durationDays: true },
  });
  if (!cycle) throw notFound("Cycle", input.cycleId);

  const weeksInCycle = Math.ceil(cycle.durationDays / 7);
  if (input.weekNumber > weeksInCycle) {
    throw unprocessable(`Cycle "${cycle.name}" has ${weeksInCycle} weeks; week ${input.weekNumber} does not exist.`, {
      weekNumber: input.weekNumber,
      weeksInCycle,
    });
  }

  // Cross-module reads go through published interfaces (§4.3).
  const demandLines = await getWeekDemandInputs(input.cycleId, input.weekNumber);

  // No early return when demand is empty: the menu may have been cleared, and
  // reconciliation still has to remove the draft orders it previously created.
  const contexts = await getIngredientContexts([...new Set(demandLines.map((line) => line.ingredientId))]);
  const { demand, exceptions: demandExceptions } = aggregateDemand(demandLines, contexts);
  const plan = buildPurchasePlan(demand, contexts);

  const result = await db.$transaction(async (tx) => {
    const orders = [];
    const skipped: { vendorId: string; vendorName: string; status: string }[] = [];

    for (const group of plan.groups) {
      const existing = await repository.findGeneratedOrder(tx, {
        cycleId: input.cycleId,
        vendorId: group.vendorId,
        weekNumber: input.weekNumber,
      });

      const lines = group.lines.map((line) => ({
        ingredientId: line.ingredientId,
        requestedQty: line.requestedQty,
        unit: line.unit,
        unitCost: line.unitCost ?? undefined,
      }));

      if (existing && !isRegenerable(existing.status)) {
        // Already ordered or received — leave it alone and say so.
        skipped.push({ vendorId: group.vendorId, vendorName: group.vendorName, status: existing.status });
        orders.push(existing);
        continue;
      }

      const order = existing
        ? await repository.replaceLines(tx, existing.id, lines)
        : await repository.createPurchaseOrder(tx, {
            vendorId: group.vendorId,
            cycleId: input.cycleId,
            weekNumber: input.weekNumber,
            status: "DRAFT",
            lines: { create: lines },
          });

      orders.push(order);
    }

    // Demand can disappear when a menu changes; drafts with no remaining
    // demand are removed so the procurement screen does not show phantom work.
    const stale = await repository.findStaleGeneratedOrders(tx, {
      cycleId: input.cycleId,
      weekNumber: input.weekNumber,
      keepVendorIds: plan.groups.map((group) => group.vendorId),
    });
    if (stale.length) await repository.deletePurchaseOrders(tx, stale.map((order) => order.id));

    await recordAudit(tx, {
      actorId: context.actor.id,
      action: "purchase_order.generated",
      entityType: "Cycle",
      entityId: input.cycleId,
      after: {
        weekNumber: input.weekNumber,
        ordersUpserted: orders.length - skipped.length,
        ordersSkipped: skipped.length,
        ordersRemoved: stale.length,
        unsourcedCount: plan.unsourced.length,
        exceptionCount: plan.exceptions.length + demandExceptions.length,
      },
      requestId: context.requestId,
    });

    return { orders, skipped, removed: stale.length };
  });

  return {
    orders: result.orders.map(toPurchaseOrderView),
    // Demanded, short on stock, but nobody is set up to supply them (BR-7).
    unsourced: plan.unsourced,
    // Quantities we refused to guess at (§6.2).
    exceptions: [...demandExceptions, ...plan.exceptions],
    covered: plan.covered,
    skipped: result.skipped,
    removed: result.removed,
    message: demandLines.length
      ? undefined
      : `No meal assignments found for week ${input.weekNumber}.`,
  };
}
