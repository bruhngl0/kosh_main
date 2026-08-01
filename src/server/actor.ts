import type { UserRole } from "@prisma/client";
import { db } from "@/server/db";
import { AppError, forbidden } from "@/server/errors";

/**
 * Actor resolution. See docs/system-design.md §8.1.
 *
 * The MVP resolves a single seeded operations user. Real sessions replace the
 * body of `resolveActor` and nothing else — every use case already threads an
 * actor through, so attribution and audit are correct from the first write.
 * Backfilling that later would be impossible.
 */

export type Actor = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export const SYSTEM_ACTOR_EMAIL = process.env.SYSTEM_ACTOR_EMAIL ?? "admin@kosh.local";

export async function resolveActor(request: Request): Promise<Actor> {
  // Outside production, a header may select a different seeded user. This is
  // how tests exercise role checks; it is inert once real auth lands.
  const impersonated =
    process.env.NODE_ENV !== "production" ? request.headers.get("x-kosh-actor") : null;

  const actor = await db.user.findFirst({
    where: { email: impersonated ?? SYSTEM_ACTOR_EMAIL, active: true },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!actor) {
    throw new AppError(
      "UNAUTHENTICATED",
      "No operations user is configured. Run the database seed to create one.",
    );
  }

  return actor;
}

// ── Authorisation ────────────────────────────────────────────────────────────

/**
 * Capabilities, not roles, are what use cases check. Adding a role becomes a
 * change to this table rather than a hunt through call sites.
 * See docs/system-design.md §8.2.
 */
export type Capability =
  | "cycles:write"
  | "recipes:write"
  | "production:write"
  | "procurement:write"
  | "inventory:write"
  | "vessels:write"
  | "read";

const CAPABILITIES: Record<Capability, readonly UserRole[]> = {
  "cycles:write": ["ADMIN", "PLANNER"],
  "recipes:write": ["ADMIN", "PLANNER"],
  "production:write": ["ADMIN", "KITCHEN"],
  "procurement:write": ["ADMIN", "PROCUREMENT"],
  "inventory:write": ["ADMIN", "PROCUREMENT", "KITCHEN"],
  "vessels:write": ["ADMIN", "PROCUREMENT"],
  read: ["ADMIN", "PLANNER", "KITCHEN", "PROCUREMENT", "VIEWER"],
};

export const can = (actor: Actor, capability: Capability) =>
  CAPABILITIES[capability].includes(actor.role);

/** Throws FORBIDDEN unless the actor holds the capability. */
export function assertCan(actor: Actor, capability: Capability): void {
  if (!can(actor, capability)) {
    throw forbidden(`Role ${actor.role} cannot perform ${capability}.`);
  }
}
