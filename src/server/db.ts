import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Under test the client emits query events so tests can assert on how many
 * round trips a use case costs. Round-trip count is a correctness concern here,
 * not just performance: a loop that is invisible against local PostgreSQL can
 * exceed Prisma's 5s transaction timeout at hosted-database latencies.
 */
function logConfig(): (Prisma.LogLevel | Prisma.LogDefinition)[] {
  if (process.env.NODE_ENV === "test") {
    return [
      { emit: "event", level: "query" },
      { emit: "stdout", level: "error" },
    ];
  }
  return process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
}

export const db = globalForPrisma.prisma ?? new PrismaClient({ log: logConfig() });

// Reuse across hot reloads in development, and across warm invocations on
// Vercel's Fluid Compute, so we do not exhaust Neon's connection pool.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Anything that can run a query: the client itself, or a transaction handle.
 *
 * Repositories and the audit writer accept this so the same function works
 * inside and outside a transaction. Use cases own the transaction boundary;
 * repositories never open one.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export { Prisma };
