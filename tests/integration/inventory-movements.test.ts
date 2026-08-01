import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedActor } from "../support/setup-database";
import { balanceOf, makeIngredient } from "../support/factories";
import { recordMovement } from "@/modules/inventory";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/actor";

/** BR-9, BR-10, BR-11 against a real database. */

let actor: Actor;
const context = () => ({ actor, requestId: "test-request" });

beforeEach(async () => {
  await resetDatabase();
  actor = await seedActor("ADMIN");
});

describe("recordMovement", () => {
  it("writes a movement and updates the balance in one transaction", async () => {
    const ingredient = await makeIngredient({ quantity: 5 });

    const movement = await recordMovement(
      { ingredientId: ingredient.id, type: "RECEIVE", quantity: 3, allowNegative: false },
      context(),
    );

    expect(Number(movement.quantityDelta)).toBe(3);
    expect(Number(movement.balanceAfter)).toBe(8);
    expect(await balanceOf(ingredient.id)).toBe(8);
  });

  it("attributes the movement to the acting user", async () => {
    const ingredient = await makeIngredient({ quantity: 5 });
    const movement = await recordMovement(
      { ingredientId: ingredient.id, type: "RECEIVE", quantity: 1, allowNegative: false },
      context(),
    );
    expect(movement.actorId).toBe(actor.id);
  });

  it("records balanceAfter so history can be replayed", async () => {
    const ingredient = await makeIngredient({ quantity: 0 });
    for (const quantity of [5, 3, 2]) {
      await recordMovement(
        { ingredientId: ingredient.id, type: "RECEIVE", quantity, allowNegative: false },
        context(),
      );
    }

    const movements = await db.inventoryMovement.findMany({
      where: { ingredientId: ingredient.id },
      orderBy: { createdAt: "asc" },
    });
    expect(movements.map((m) => Number(m.balanceAfter))).toEqual([5, 8, 10]);
  });

  // BR-10
  it("refuses to drive the balance negative and leaves it untouched", async () => {
    const ingredient = await makeIngredient({ quantity: 2 });

    await expect(
      recordMovement(
        { ingredientId: ingredient.id, type: "CONSUME", quantity: 5, allowNegative: false },
        context(),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await balanceOf(ingredient.id)).toBe(2);
    expect(await db.inventoryMovement.count()).toBe(0);
  });

  it("allows an authorised override and flags the movement", async () => {
    const ingredient = await makeIngredient({ quantity: 2 });

    const movement = await recordMovement(
      { ingredientId: ingredient.id, type: "CONSUME", quantity: 5, allowNegative: true },
      context(),
    );

    expect(movement.negativeOverride).toBe(true);
    expect(await balanceOf(ingredient.id)).toBe(-3);
  });

  // §6.2 — quantities may arrive in any unit
  it("converts the supplied unit into the ingredient stock unit", async () => {
    const ingredient = await makeIngredient({ defaultUnit: "kg", quantity: 0 });

    const movement = await recordMovement(
      { ingredientId: ingredient.id, type: "RECEIVE", quantity: 500, unit: "g", allowNegative: false },
      context(),
    );

    expect(Number(movement.quantityDelta)).toBe(0.5);
    expect(movement.unit).toBe("kg");
    expect(await balanceOf(ingredient.id)).toBe(0.5);
  });

  it("refuses an unconvertible unit rather than guessing", async () => {
    const ingredient = await makeIngredient({ defaultUnit: "kg", quantity: 0 });

    await expect(
      recordMovement(
        { ingredientId: ingredient.id, type: "RECEIVE", quantity: 2, unit: "bunch", allowNegative: false },
        context(),
      ),
    ).rejects.toMatchObject({ code: "UNCONVERTIBLE_UNIT" });

    expect(await balanceOf(ingredient.id)).toBe(0);
  });

  it("sets the balance outright for an adjustment", async () => {
    const ingredient = await makeIngredient({ quantity: 10 });

    await recordMovement(
      { ingredientId: ingredient.id, type: "ADJUST", quantity: 4, reason: "stock count", allowNegative: false },
      context(),
    );

    expect(await balanceOf(ingredient.id)).toBe(4);
  });

  it("writes an audit event in the same transaction", async () => {
    const ingredient = await makeIngredient({ quantity: 1 });
    await recordMovement(
      { ingredientId: ingredient.id, type: "RECEIVE", quantity: 1, allowNegative: false },
      context(),
    );

    const audits = await db.auditEvent.findMany({ where: { action: "inventory.movement" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(actor.id);
    expect(audits[0].requestId).toBe("test-request");
  });

  it("rolls the audit event back when the movement fails", async () => {
    const ingredient = await makeIngredient({ quantity: 0 });

    await expect(
      recordMovement(
        { ingredientId: ingredient.id, type: "CONSUME", quantity: 1, allowNegative: false },
        context(),
      ),
    ).rejects.toBeInstanceOf(AppError);

    expect(await db.auditEvent.count()).toBe(0);
  });

  it("rejects an unknown ingredient with NOT_FOUND", async () => {
    await expect(
      recordMovement(
        {
          ingredientId: "00000000-0000-4000-8000-000000000000",
          type: "RECEIVE",
          quantity: 1,
          allowNegative: false,
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forbids a viewer from changing stock", async () => {
    const ingredient = await makeIngredient({ quantity: 1 });
    const viewer = { ...actor, role: "VIEWER" as const };

    await expect(
      recordMovement(
        { ingredientId: ingredient.id, type: "RECEIVE", quantity: 1, allowNegative: false },
        { actor: viewer, requestId: "test-request" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
