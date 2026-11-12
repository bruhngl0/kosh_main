import { Prisma, type DbClient } from "@/server/db";

/**
 * Audit trail. See docs/system-design.md §8.3.
 *
 * Written with the SAME transaction handle as the change it describes, so the
 * trail can never disagree with the data. Passing the bare client here is a
 * mistake: the audit row would survive a rollback of the thing it records.
 */

export type AuditAction =
  | "cycle.created"
  | "cycle.updated"
  | "cycle.published"
  | "cycle.deleted"
  | "meal.assigned"
  | "meal.cleared"
  | "prep.generated"
  | "prep.updated"
  | "recipe.created"
  | "recipe.updated"
  | "recipe.archived"
  | "recipe_version.created"
  | "recipe_version.updated"
  | "recipe_version.published"
  | "ingredient.created"
  | "ingredient.updated"
  | "ingredient.archived"
  | "inventory.movement"
  | "vendor.created"
  | "vendor.updated"
  | "vendor.deactivated"
  | "vendor_ingredient.linked"
  | "purchase_order.generated"
  | "purchase_order.created"
  | "purchase_order.status_changed"
  | "purchase_order.received"
  | "production.consumed"
  | "vessel_kit.created"
  | "vessel_kit.updated"
  | "vessel_kit.sanitised"
  | "cash_transaction.created"
  | "cash_transaction.updated"
  | "cash_transaction.deleted"
  | "cash_transaction.imported"
  | "cash_opening_balance.set"
  | "recurring_cost.created"
  | "recurring_cost.updated"
  | "subscriber.created"
  | "subscriber.updated"
  | "subscriber.synced"
  | "cycle.headcount_synced"
  | "run_sheet.updated"
  | "run_sheet.task_added"
  | "run_sheet.task_removed";

export type AuditInput = {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
};

export async function recordAudit(client: DbClient, input: AuditInput): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: snapshot(input.before),
      after: snapshot(input.after),
      requestId: input.requestId,
    },
  });
}

/** Convenience for use cases that write several audit rows in one transaction. */
export async function recordAudits(client: DbClient, inputs: AuditInput[]): Promise<void> {
  for (const input of inputs) await recordAudit(client, input);
}

/**
 * Makes a domain object safe for a JSONB column: Decimals become strings so
 * precision survives, Dates become ISO, and anything non-serialisable is
 * dropped rather than throwing inside a transaction.
 */
export function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return toJson(value) as Prisma.InputJsonValue;
}

function toJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map(toJson);

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "function" || typeof item === "symbol") continue;
      result[key] = toJson(item);
    }
    return result;
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;
  return value;
}
