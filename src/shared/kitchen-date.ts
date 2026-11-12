/**
 * The kitchen's calendar. Every module that asks "what day is it?" asks here,
 * so a day boundary means the same thing to finance, cycles and the run sheet.
 */

/** Bengaluru. India has no daylight saving, so a fixed offset is exact. */
export const KITCHEN_UTC_OFFSET_MINUTES = 330;
export const KITCHEN_OFFSET_MS = KITCHEN_UTC_OFFSET_MINUTES * 60_000;

/** The kitchen-local calendar date (YYYY-MM-DD) of an instant. */
export const kitchenDate = (instant: Date) => new Date(instant.getTime() + KITCHEN_OFFSET_MS).toISOString().slice(0, 10);
