/**
 * BR-27 — the standard daily checklist.
 * Ported from Kosh_Daily_Run_Sheet.html:251.
 *
 * Kept in code, not the database: it is the kitchen's standing procedure and
 * changes through review like any other rule. A day's ticks are stored against
 * these ids, so an id must never be reused for a different task. Retire a task
 * by deleting it; add a new one under a new id.
 *
 * Pure: no I/O.
 */

import type { PhaseId, TaskOwner } from "@/shared/schemas/run-sheet";

export type ChecklistTask = {
  id: string;
  title: string;
  sub?: string;
  owner: TaskOwner;
  time: string;
  critical?: boolean;
  vessel?: boolean;
  /**
   * Ticked by the system, not by hand: "production" is done once every meal
   * of the day has been recorded against stock (BR-31).
   */
  derived?: "production";
};

export type ChecklistPhase = {
  id: PhaseId;
  name: string;
  window: string;
  tasks: ChecklistTask[];
};

export const CHECKLIST: readonly ChecklistPhase[] = [
  {
    id: "prep",
    name: "Kitchen Setup & Mise en Place",
    window: "4:30 AM – 6:00 AM",
    tasks: [
      { id: "p1", title: "Kitchen deep-clean check from previous night", sub: "Surfaces, fridge seals, floor — pass before starting", owner: "Chef", time: "4:30 AM", critical: true },
      { id: "p2", title: "Pull all refrigerated proteins to temper", sub: "Proteins to room temp 30–60 min before cooking", owner: "Chef", time: "4:35 AM" },
      { id: "p3", title: "Check advance-prep items (marinades, braises, set items)", sub: "Confirm day-prior prep is ready and within temp", owner: "Chef", time: "4:40 AM", critical: true },
      { id: "p4", title: "Weigh and portion all proteins per subscriber count", sub: "Each subscriber's protein weighed separately per macro target", owner: "Chef", time: "4:50 AM", critical: true },
      { id: "p5", title: "Prepare all grains and carbohydrates", sub: "Start long-cook grains first", owner: "Chef", time: "5:00 AM" },
      { id: "p6", title: "Prepare all dals, legumes, and pulses", sub: "Pressure-cook or soak-boil depending on dish", owner: "Chef", time: "5:10 AM" },
      { id: "p9", title: "Prepare breakfast components for all subscribers", sub: "Oats, batters, egg prep, toast elements — mise complete", owner: "Chef", time: "5:15 AM" },
      { id: "p7", title: "Prep all vegetable components", sub: "Roast, steam, pickle, sauté — per today's menu", owner: "Chef", time: "5:20 AM" },
      { id: "p8", title: "Prepare sauces, chutneys, and dressings", sub: "All finishing elements ready before protein cook", owner: "Chef", time: "5:30 AM" },
      { id: "p10", title: "Prepare snack boxes", sub: "Weigh nuts, seeds, portions — seal in small containers", owner: "Assist", time: "5:30 AM" },
    ],
  },
  {
    id: "cook",
    name: "Main Cook — Proteins & Assembly",
    window: "6:00 AM – 7:00 AM",
    tasks: [
      { id: "c1", title: "Cook all proteins to spec (internal temp verified)", sub: "Probe thermometer check on every protein batch", owner: "Chef", time: "6:00 AM", critical: true },
      { id: "c2", title: "Taste and season all dishes — no over-salting", sub: "Sodium ceiling: 1,800mg total for day", owner: "Chef", time: "6:30 AM", critical: true },
      { id: "c3", title: "Verify macro portions per subscriber profile", sub: "Use precision scale — no eyeballing on subscriber meals", owner: "Chef", time: "6:40 AM", critical: true },
      { id: "c4", title: "Cook all breakfast items", sub: "Eggs to order per subscriber preference. Dosas, omelettes last.", owner: "Chef", time: "6:45 AM" },
      { id: "c5", title: "Final quality check — all four meals for each subscriber", sub: "Temp, appearance, portion, smell. Reject anything substandard.", owner: "Chef", time: "6:55 AM", critical: true },
    ],
  },
  {
    id: "pack",
    name: "Packing & Vessel Loading",
    window: "7:00 AM – 7:30 AM",
    tasks: [
      { id: "pk0", title: "Allergen check against today's alerts", sub: "Every flagged subscriber's vessel packed without the clashing dish", owner: "Chef", time: "7:00 AM", critical: true },
      { id: "pk1", title: "Retrieve vessels from overnight sanitisation", sub: "Verify all vessels are dry, sealed, and engraving is visible", owner: "Assist", time: "7:00 AM", critical: true, vessel: true },
      { id: "pk2", title: "Label each vessel with subscriber name + day number", sub: "Kōsh label: Name / Day X of 28 / Cycle N", owner: "Assist", time: "7:00 AM", vessel: true },
      { id: "pk3", title: "Pack breakfast + snack into vessel top compartment", sub: "Breakfast reheats in 3 min. Snack stays cold.", owner: "Chef", time: "7:05 AM", vessel: true },
      { id: "pk4", title: "Pack lunch into vessel main compartment", sub: "All sides nested in GN sub-pans. Lid sealed.", owner: "Chef", time: "7:10 AM", vessel: true },
      { id: "pk5", title: "Pack dinner into vessel bottom compartment", sub: "Dinner reheats in 4–5 min. Include heating note card.", owner: "Chef", time: "7:15 AM", vessel: true },
      { id: "pk6", title: "Insert daily macro card into each vessel", sub: "Name / Kcal / Protein / Carbs / Fat / Day number", owner: "Assist", time: "7:20 AM" },
      { id: "pk7", title: "Final vessel count — match to delivery list", sub: "No vessel should leave without a name. No name without a vessel.", owner: "Assist", time: "7:25 AM", critical: true, vessel: true },
      { id: "pk8", title: "Load vessels into insulated delivery bags by zone", sub: "Sadashivanagar bag A / Dollars Colony bag B", owner: "Assist", time: "7:25 AM" },
    ],
  },
  {
    id: "dispatch",
    name: "Dispatch & Delivery",
    window: "7:30 AM – 9:00 AM",
    tasks: [
      { id: "d1", title: "Rider briefed on delivery order and subscriber notes", sub: "Access codes, gate instructions, allergy alerts", owner: "Rider", time: "7:30 AM", critical: true },
      { id: "d2", title: "Dispatch confirmed — all vessels loaded", sub: "Photograph loaded bags before rider departs", owner: "Assist", time: "7:30 AM", critical: true },
      { id: "d3", title: "WhatsApp dispatch notification sent to all subscribers", sub: "\"Your box is on its way. Day X of 28.\" — no other text.", owner: "Assist", time: "7:32 AM" },
      { id: "d4", title: "All Sadashivanagar deliveries completed", sub: "Target: every door by 8:15 AM", owner: "Rider", time: "8:15 AM" },
      { id: "d5", title: "All Dollars Colony deliveries completed", sub: "Target: every door by 8:45 AM", owner: "Rider", time: "8:45 AM" },
      { id: "d6", title: "Delivery confirmation photos taken at each door", sub: "One photo per subscriber — stored in WhatsApp group", owner: "Rider", time: "9:00 AM" },
      { id: "d7", title: "Any failed deliveries reported immediately", sub: "Subscriber unreachable — leave at door, WhatsApp alert", owner: "Rider", time: "9:00 AM", critical: true },
    ],
  },
  {
    id: "close",
    name: "Kitchen Close & Advance Prep",
    window: "9:00 AM – 12:00 PM",
    tasks: [
      { id: "k0", title: "Production recorded against stock", sub: "Ticks itself once today's meals are taken off inventory — use the Stock card", owner: "Chef", time: "9:00 AM", critical: true, derived: "production" },
      { id: "k1", title: "Full kitchen clean-down after dispatch", sub: "Surfaces, equipment, floors. No exceptions.", owner: "Assist", time: "9:00 AM" },
      { id: "k2", title: "Advance prep due today (see the prep list)", sub: "Every item due today ticked off or skipped with a reason", owner: "Chef", time: "9:30 AM" },
      { id: "k3", title: "Start any long-cook items for tomorrow", sub: "Braises, bone broths, marinades, sous-vide items", owner: "Chef", time: "10:00 AM" },
      { id: "k4", title: "Stock take — replenishment order placed", sub: "Any ingredient below 2-day par level must be ordered today", owner: "Chef", time: "10:30 AM" },
      { id: "k5", title: "Refrigerator temp check and FIFO rotation", sub: "All items labelled with date. Nothing unlabelled.", owner: "Assist", time: "11:00 AM" },
      { id: "k6", title: "Tomorrow's macro cards printed and prepared", sub: "Name / Day number / all four macro values per subscriber", owner: "Assist", time: "11:30 AM" },
    ],
  },
  {
    id: "evening",
    name: "Evening — Vessel Collection & Sanitisation",
    window: "6:30 PM – 10:00 PM",
    tasks: [
      { id: "e1", title: "Evening collection WhatsApp reminder sent", sub: "\"Please leave your vessel at the door by 9 PM.\" Direct, no exclamation marks.", owner: "Assist", time: "6:30 PM", vessel: true },
      { id: "e2", title: "Rider begins collection round — Sadashivanagar", sub: "Collect from all subscribers. Check name engraving.", owner: "Rider", time: "7:00 PM", critical: true, vessel: true },
      { id: "e3", title: "Rider completes collection round — Dollars Colony", sub: "Target: all vessels collected by 8:30 PM", owner: "Rider", time: "8:30 PM", critical: true, vessel: true },
      { id: "e4", title: "Vessel count on return — no vessel missing", sub: "Mark each vessel below. Follow up any missing.", owner: "Assist", time: "8:45 PM", critical: true, vessel: true },
      { id: "e5", title: "Pre-rinse all returned vessels", sub: "Remove food residue. Pre-soak stubborn items.", owner: "Assist", time: "8:45 PM", vessel: true },
      { id: "e9", title: "Any subscriber feedback logged in notes", sub: "Taste, quantity, allergy concerns, delivery issues", owner: "Assist", time: "9:00 PM" },
      { id: "e6", title: "Run commercial dishwasher — full load, 85°C cycle", sub: "Minimum 85°C wash cycle. Food-safe sanitiser in cycle.", owner: "Assist", time: "9:00 PM", critical: true, vessel: true },
      { id: "e7", title: "Air-dry all vessels completely", sub: "No towel-drying — air dry only.", owner: "Assist", time: "9:30 PM", vessel: true },
      { id: "e8", title: "Seal and store vessels for tomorrow's dispatch", sub: "Stack in delivery order. Cover with clean cloth.", owner: "Assist", time: "10:00 PM", vessel: true },
      { id: "e10", title: "Kitchen security check and lock-up", sub: "All gas off. Fridges checked. Lights off. Alarm set.", owner: "Chef", time: "10:00 PM", critical: true },
    ],
  },
];

export const STANDARD_TASK_IDS: ReadonlySet<string> = new Set(CHECKLIST.flatMap((phase) => phase.tasks.map((task) => task.id)));

export const isStandardTask = (key: string) => STANDARD_TASK_IDS.has(key);

/** Tasks the system ticks. They cannot be ticked by hand or by "mark all done". */
export const DERIVED_TASK_IDS: ReadonlySet<string> = new Set(
  CHECKLIST.flatMap((phase) => phase.tasks.filter((task) => task.derived).map((task) => task.id)),
);

/** The evening wash. Ticking it stamps the sanitisation date on every vessel collected that day (BR-32). */
export const SANITISE_TASK_ID = "e6";
