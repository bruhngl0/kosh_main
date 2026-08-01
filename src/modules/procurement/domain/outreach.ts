/**
 * Vendor outreach message generation.
 * Ported from Kosh_Inventory.html:797, which the React rewrite had reduced to
 * four lines. The full template matters: vendors are small market stalls, and
 * the message has to carry the delivery deadline and the standing-arrangement
 * framing or the order does not arrive at 05:30.
 *
 * Pure: no I/O. Read-only projection — actually sending is out of scope (§3).
 */

export type OutreachLine = {
  ingredientName: string;
  quantity: number;
  unit: string;
  notes?: string | null;
};

export type OutreachInput = {
  vendorName: string;
  contactName?: string | null;
  whatsapp?: string | null;
  lines: OutreachLine[];
  chefName?: string | null;
  /** Human-readable week label, e.g. "20 July 2026". */
  weekLabel?: string | null;
  cycleLabel?: string | null;
  subscriberCount: number;
  /** Latest acceptable delivery time. */
  deliveryDeadline?: string;
};

export type OutreachMessage = {
  vendorName: string;
  /** Plain text, ready to paste into WhatsApp. */
  message: string;
  /** wa.me deep link, or null when the vendor has no WhatsApp number. */
  whatsappUrl: string | null;
  lineCount: number;
};

const DEFAULT_DEADLINE = "5:30 AM";

export function buildOutreachMessage(input: OutreachInput): OutreachMessage {
  const greeting = input.contactName?.trim() ? `Hi ${input.contactName.trim()},` : "Hi,";
  const deadline = input.deliveryDeadline ?? DEFAULT_DEADLINE;

  const itemLines = input.lines
    .map((line) => {
      const note = line.notes?.trim() ? ` (${line.notes.trim()})` : "";
      return `  • ${line.ingredientName} — ${formatAmount(line.quantity)} ${line.unit}${note}`;
    })
    .join("\n");

  const message = [
    greeting,
    "",
    `I'm ordering from *Kōsh Private Kitchen*, Sadashivnagar, Bengaluru. We are a daily subscription kitchen serving ${input.subscriberCount} households — all meals prepared and delivered every morning.`,
    "",
    `Week of: *${input.weekLabel?.trim() || "[Week of]"}*`,
    `Menu cycle: *${input.cycleLabel?.trim() || "[Cycle days]"}*`,
    `Chef: *${input.chefName?.trim() || "[Chef]"}*`,
    "",
    "Could you please confirm availability and pricing for:",
    "",
    itemLines,
    "",
    `We need delivery *by ${deadline} latest* (or pickup arranged evening prior if needed).`,
    "",
    "Please confirm:",
    "✓ Availability of each item",
    "✓ Price per unit",
    "✓ Earliest delivery slot",
    "",
    "We order from you every week as a standing arrangement. Thank you.",
    "",
    "— Kōsh Kitchen, Sadashivnagar",
  ].join("\n");

  return {
    vendorName: input.vendorName,
    message,
    whatsappUrl: whatsappLink(input.whatsapp, message),
    lineCount: input.lines.length,
  };
}

/**
 * Builds a wa.me link. Numbers are stored in assorted human formats
 * ("+91 98440 11111", "080-4040 3333"); wa.me needs digits only.
 */
export function whatsappLink(number: string | null | undefined, message?: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

const formatAmount = (value: number) =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
