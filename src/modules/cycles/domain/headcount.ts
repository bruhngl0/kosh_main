/**
 * BR-30 — servings follow the subscriber roster.
 *
 * Each meal is cooked for the people actually delivered to on its date: the
 * roster count for that day, so someone starting on day 10 is cooked for from
 * day 10. Two kinds of servings are left alone:
 *
 *   - servings someone set by hand (`locked`) — extra portions for a tasting,
 *     a staff meal, a known absence;
 *   - days already past — they record what was cooked, and production may have
 *     been consumed against them (BR-14).
 *
 * A cycle with no start date has no dates, so every day uses today's count.
 *
 * Pure: no I/O.
 */

export type HeadcountDay = {
  dayNumber: number;
  /** YYYY-MM-DD, or null when the cycle has no start date. */
  date: string | null;
  assignments: { id: string; servings: number; locked: boolean }[];
};

export type HeadcountChange = { assignmentId: string; dayNumber: number; from: number; to: number };

/** The dates whose roster count the plan needs. */
export function datesNeeded(days: HeadcountDay[], today: string): string[] {
  const dates = new Set<string>();
  for (const day of days) {
    if (day.date === null) dates.add(today);
    else if (day.date >= today) dates.add(day.date);
  }
  return [...dates];
}

/**
 * The servings changes that bring a cycle in line with the roster. Never
 * returns a count below 1: a day with nobody on the roster keeps one portion
 * rather than violating the servings constraint, and the run sheet shows the
 * real delivery count anyway.
 */
export function planHeadcount(days: HeadcountDay[], today: string, countOn: Record<string, number>): HeadcountChange[] {
  const changes: HeadcountChange[] = [];
  for (const day of days) {
    const date = day.date ?? today;
    if (date < today) continue;
    const target = Math.max(1, countOn[date] ?? 0);
    for (const assignment of day.assignments) {
      if (assignment.locked || assignment.servings === target) continue;
      changes.push({ assignmentId: assignment.id, dayNumber: day.dayNumber, from: assignment.servings, to: target });
    }
  }
  return changes;
}

/** The date a cycle's headline head-count describes: today, or its first day if it has not started. */
export function headlineDate(weekStart: string | null, today: string): string {
  return weekStart && weekStart > today ? weekStart : today;
}
