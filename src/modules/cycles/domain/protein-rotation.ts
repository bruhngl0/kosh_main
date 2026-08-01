/**
 * BR-1 and BR-2 — dinner protein rotation.
 * Ported from Kosh_Cycle_Planner.html:421 and :536.
 *
 * Pure: no I/O, no Prisma, no framework.
 */

/** Staples, not features. Repeating them is not a menu failure. */
export const EXEMPT_PROTEINS = ["plant", "dairy", "legume"] as const;

export const DEFAULT_PROTEIN_WINDOW_DAYS = 4;

const SUGGESTED_SWAPS: Record<string, string> = {
  chicken: "fish or lamb",
  fish: "chicken or plant",
  prawn: "duck or beef",
  lamb: "prawn or fish",
  salmon: "chicken or plant",
  beef: "fish or pork",
};

export type DinnerDay = {
  dayNumber: number;
  /** Protein source of the dinner assignment, if the slot is filled. */
  protein: string | null;
};

export type ProteinConflict = {
  /** The day that repeats the protein. */
  dayNumber: number;
  /** The earlier day it collides with. */
  previousDayNumber: number;
  protein: string;
  /** Gap in days between the two. Always < windowDays. */
  gapDays: number;
  suggestedSwap: string;
};

export const isExemptProtein = (protein: string) =>
  (EXEMPT_PROTEINS as readonly string[]).includes(protein.trim().toLowerCase());

export const suggestSwap = (protein: string) =>
  SUGGESTED_SWAPS[protein.trim().toLowerCase()] ?? "a different protein category";

/**
 * Finds every pair of dinners sharing a protein within the rolling window.
 *
 * The window is expressed in *day numbers*, not array positions, so a cycle
 * with gaps in its days behaves correctly. The prototype compared array indices
 * and only happened to be right because its days were dense and sorted.
 */
export function findProteinConflicts(
  days: DinnerDay[],
  windowDays: number = DEFAULT_PROTEIN_WINDOW_DAYS,
): ProteinConflict[] {
  const candidates = days
    .filter((day): day is DinnerDay & { protein: string } => Boolean(day.protein))
    .map((day) => ({ ...day, protein: day.protein.trim().toLowerCase() }))
    .filter((day) => !isExemptProtein(day.protein))
    .sort((a, b) => a.dayNumber - b.dayNumber);

  const conflicts: ProteinConflict[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const current = candidates[i];
    for (let j = i + 1; j < candidates.length; j += 1) {
      const next = candidates[j];
      const gapDays = next.dayNumber - current.dayNumber;
      if (gapDays >= windowDays) break; // sorted, so nothing further can be closer
      if (next.protein !== current.protein) continue;

      conflicts.push({
        dayNumber: next.dayNumber,
        previousDayNumber: current.dayNumber,
        protein: current.protein,
        gapDays,
        suggestedSwap: suggestSwap(current.protein),
      });
    }
  }

  return conflicts;
}

/** Day numbers that carry at least one conflict — used to mark the calendar. */
export const conflictedDayNumbers = (conflicts: ProteinConflict[]) =>
  new Set(conflicts.map((conflict) => conflict.dayNumber));
