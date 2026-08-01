import { describe, expect, it } from "vitest";
import { buildOutreachMessage, whatsappLink } from "@/modules/procurement/domain/outreach";

// Parity with Kosh_Inventory.html:797

const input = {
  vendorName: "Russel Market — Fish & Seafood",
  contactName: "Salim",
  whatsapp: "+91 98440 11111",
  subscriberCount: 37,
  chefName: "Aditya",
  weekLabel: "20 July 2026",
  cycleLabel: "Day 1–5",
  lines: [
    { ingredientName: "Sashimi-grade salmon fillet", quantity: 2, unit: "kg", notes: "Skin-on portions 150g each" },
    { ingredientName: "Tiger prawns (16–20 count)", quantity: 1.5, unit: "kg", notes: null },
  ],
};

describe("buildOutreachMessage", () => {
  it("addresses the named contact", () => {
    expect(buildOutreachMessage(input).message).toContain("Hi Salim,");
  });

  it("falls back to a plain greeting with no contact", () => {
    const result = buildOutreachMessage({ ...input, contactName: null });
    expect(result.message).toContain("Hi,");
    expect(result.message).not.toContain("Hi ,");
  });

  it("carries the operational context the vendor needs", () => {
    const { message } = buildOutreachMessage(input);
    expect(message).toContain("37 households");
    expect(message).toContain("Week of: *20 July 2026*");
    expect(message).toContain("Menu cycle: *Day 1–5*");
    expect(message).toContain("Chef: *Aditya*");
  });

  // The delivery deadline is the whole point of the message.
  it("states the delivery deadline", () => {
    expect(buildOutreachMessage(input).message).toContain("*by 5:30 AM latest*");
  });

  it("accepts a custom deadline", () => {
    const result = buildOutreachMessage({ ...input, deliveryDeadline: "6:00 AM" });
    expect(result.message).toContain("*by 6:00 AM latest*");
  });

  it("lists each item with quantity, unit, and spec note", () => {
    const { message } = buildOutreachMessage(input);
    expect(message).toContain("• Sashimi-grade salmon fillet — 2 kg (Skin-on portions 150g each)");
    expect(message).toContain("• Tiger prawns (16–20 count) — 1.5 kg");
  });

  it("omits an empty note without leaving stray brackets", () => {
    const { message } = buildOutreachMessage(input);
    expect(message).not.toContain("— 1.5 kg ()");
  });

  it("uses placeholders for missing planning context", () => {
    const { message } = buildOutreachMessage({
      ...input,
      chefName: null,
      weekLabel: null,
      cycleLabel: "   ",
    });
    expect(message).toContain("Chef: *[Chef]*");
    expect(message).toContain("Week of: *[Week of]*");
    expect(message).toContain("Menu cycle: *[Cycle days]*");
  });

  it("reports the line count", () => {
    expect(buildOutreachMessage(input).lineCount).toBe(2);
  });
});

describe("whatsappLink", () => {
  it("strips formatting to digits", () => {
    expect(whatsappLink("+91 98440 11111")).toBe("https://wa.me/919844011111");
    expect(whatsappLink("080-4040 3333")).toBe("https://wa.me/08040403333");
  });

  it("returns null for a missing or unusable number", () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink("")).toBeNull();
    expect(whatsappLink("12345")).toBeNull();
  });

  it("embeds the prefilled message", () => {
    const link = whatsappLink("+91 98440 11111", "Hi Salim");
    expect(link).toBe("https://wa.me/919844011111?text=Hi%20Salim");
  });

  it("is attached to the built message when the vendor has WhatsApp", () => {
    const result = buildOutreachMessage(input);
    expect(result.whatsappUrl).toContain("https://wa.me/919844011111?text=");
  });

  it("is null on the message when the vendor has no WhatsApp", () => {
    expect(buildOutreachMessage({ ...input, whatsapp: null }).whatsappUrl).toBeNull();
  });
});
