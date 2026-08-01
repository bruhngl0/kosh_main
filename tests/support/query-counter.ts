import { db } from "@/server/db";

/**
 * Counts database round trips for a block of work.
 *
 * Exists because round-trip count is a correctness concern, not a micro-
 * optimisation: a per-row loop costs ~1ms locally and ~30ms against a hosted
 * database, and inside a transaction that difference is the gap between working
 * and hitting Prisma's 5s timeout. See docs/system-design.md §9.
 */

type QueryEvent = { query: string };

/** Prisma has no `$off`, so one listener is registered and redirected. */
let collector: string[] | null = null;
let listening = false;

function ensureListener() {
  if (listening) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).$on("query", (event: QueryEvent) => {
    const query = event.query.trim();
    // Transaction control is protocol overhead, not work the code chose to do.
    if (collector && !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/i.test(query)) {
      collector.push(query.slice(0, 160));
    }
  });
  listening = true;
}

export async function countQueries<T>(
  work: () => Promise<T>,
): Promise<{ result: T; queries: number; statements: string[] }> {
  ensureListener();

  const statements: string[] = [];
  collector = statements;
  try {
    const result = await work();
    // Query events are emitted asynchronously; let them drain before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { result, queries: statements.length, statements };
  } finally {
    collector = null;
  }
}
