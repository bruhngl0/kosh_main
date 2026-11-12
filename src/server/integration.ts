import { timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/actor";

/**
 * Service-to-service authentication. See docs/system-design.md BR-23.
 *
 * The onboarding app calls in with `Authorization: Bearer <ONBOARDING_SYNC_TOKEN>`.
 * A valid token resolves to a dedicated INTEGRATION user, so every change the
 * sync makes is attributed in the audit trail like any other write. That role
 * holds only `subscribers:sync` — it cannot read or change anything else.
 */

export const ONBOARDING_ACTOR_EMAIL = "onboarding-sync@kosh.local";
const MIN_TOKEN_LENGTH = 32;

export async function resolveOnboardingActor(request: Request): Promise<Actor> {
  const expected = process.env.ONBOARDING_SYNC_TOKEN;
  if (!expected || expected.length < MIN_TOKEN_LENGTH) {
    throw new AppError("INTERNAL_ERROR", "Onboarding sync is not configured on this server.");
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!tokensMatch(presented, expected)) {
    throw new AppError("UNAUTHENTICATED", "Missing or invalid service token.");
  }

  return db.user.upsert({
    where: { email: ONBOARDING_ACTOR_EMAIL },
    update: {},
    create: { name: "Onboarding app", email: ONBOARDING_ACTOR_EMAIL, role: "INTEGRATION" },
    select: { id: true, name: true, email: true, role: true },
  });
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on unequal lengths. */
function tokensMatch(presented: string, expected: string) {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
