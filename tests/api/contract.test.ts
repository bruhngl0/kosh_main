import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, seedActor } from "../support/setup-database";
import { makeCycle, makeIngredient, makeRecipe } from "../support/factories";

import * as cyclesRoute from "@/app/api/v1/cycles/route";
import * as cycleRoute from "@/app/api/v1/cycles/[id]/route";
import * as publishRoute from "@/app/api/v1/cycles/[id]/publish/route";
import * as mealRoute from "@/app/api/v1/cycles/[id]/days/[day]/meals/[meal]/route";
import * as ingredientsRoute from "@/app/api/v1/ingredients/route";
import * as ingredientRoute from "@/app/api/v1/ingredients/[id]/route";
import * as movementsRoute from "@/app/api/v1/inventory/movements/route";
import * as healthRoute from "@/app/api/v1/health/route";
import * as csvRoute from "@/app/api/v1/inventory/export.csv/route";

/**
 * API contract tests. See docs/system-design.md §7.
 *
 * These call the route handlers directly rather than over HTTP, so they cover
 * the envelope, the error taxonomy, and validation without needing a server.
 */

const BASE = "http://localhost/api/v1";

const request = (path: string, init?: RequestInit) => new Request(`${BASE}${path}`, init);

const json = (path: string, method: string, body: unknown) =>
  request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  await resetDatabase();
  await seedActor("ADMIN");
});

describe("response envelope", () => {
  it("wraps success in data + meta with a request ID", async () => {
    const { status, body } = await read(await healthRoute.GET(request("/health"), params({})));

    expect(status).toBe(200);
    expect(body).toHaveProperty("data.status", "ok");
    expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("echoes the request ID in a header for log correlation", async () => {
    const response = await healthRoute.GET(request("/health"), params({}));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 201 with created:true for creations", async () => {
    const { status, body } = await read(
      await cyclesRoute.POST(json("/cycles", "POST", { name: "Cycle 02", cycleNumber: 2 }), params({})),
    );

    expect(status).toBe(201);
    expect(body.meta.created).toBe(true);
    expect(body.data.name).toBe("Cycle 02");
  });
});

describe("validation (400)", () => {
  it("rejects a malformed body with field errors", async () => {
    const { status, body } = await read(
      await cyclesRoute.POST(json("/cycles", "POST", { name: "", cycleNumber: -1 }), params({})),
    );

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toBeDefined();
  });

  it("rejects a body that is not JSON", async () => {
    const { status, body } = await read(
      await cyclesRoute.POST(
        request("/cycles", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" }),
        params({}),
      ),
    );

    expect(status).toBe(400);
    expect(body.error.message).toContain("valid JSON");
  });

  it("rejects a malformed path parameter", async () => {
    const { status, body } = await read(
      await cycleRoute.GET(request("/cycles/nope"), params({ id: "nope" })),
    );

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // Previously cast straight into Prisma and surfaced as a 500.
  it("rejects an unknown meal slot as a 400, not a 500", async () => {
    const cycle = await makeCycle({ durationDays: 1 });
    const { version } = await makeRecipe({ mealType: "BF" });

    const { status, body } = await read(
      await mealRoute.PUT(
        json(`/cycles/${cycle.id}/days/1/meals/XX`, "PUT", { recipeVersionId: version.id }),
        params({ id: cycle.id, day: "1", meal: "XX" }),
      ),
    );

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-numeric day as a 400", async () => {
    const cycle = await makeCycle({ durationDays: 1 });
    const { version } = await makeRecipe({ mealType: "BF" });

    const { status } = await read(
      await mealRoute.PUT(
        json(`/cycles/${cycle.id}/days/abc/meals/BF`, "PUT", { recipeVersionId: version.id }),
        params({ id: cycle.id, day: "abc", meal: "BF" }),
      ),
    );

    expect(status).toBe(400);
  });
});

describe("not found (404)", () => {
  it("maps a missing record to 404 rather than 500", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const { status, body } = await read(
      await ingredientRoute.GET(request(`/ingredients/${missing}`), params({ id: missing })),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("conflict (409)", () => {
  it("reports a duplicate cycle number", async () => {
    await makeCycle({ cycleNumber: 1 });

    const { status, body } = await read(
      await cyclesRoute.POST(json("/cycles", "POST", { name: "Duplicate", cycleNumber: 1 }), params({})),
    );

    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("already used");
  });

  it("reports a duplicate ingredient name", async () => {
    await makeIngredient({ name: "Baby spinach" });

    const { status, body } = await read(
      await ingredientsRoute.POST(
        json("/ingredients", "POST", {
          name: "Baby spinach",
          category: "produce",
          defaultUnit: "kg",
          defaultFrequency: "daily",
        }),
        params({}),
      ),
    );

    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });
});

describe("business rule refusals (422)", () => {
  it("returns 422 with the offending days when publish fails", async () => {
    const cycle = await makeCycle({ durationDays: 2 });

    const { status, body } = await read(
      await publishRoute.POST(request(`/cycles/${cycle.id}/publish`, { method: "POST" }), params({ id: cycle.id })),
    );

    expect(status).toBe(422);
    expect(body.error.code).toBe("UNPROCESSABLE");
    expect(body.error.details.incompleteDayNumbers).toEqual([1, 2]);
    expect(body.error.details.problems[0].message).toContain("Day 1 is missing");
  });

  it("returns 422 with the shortfall when stock is insufficient", async () => {
    const ingredient = await makeIngredient({ quantity: 1 });

    const { status, body } = await read(
      await movementsRoute.POST(
        json("/inventory/movements", "POST", { ingredientId: ingredient.id, type: "CONSUME", quantity: 5 }),
        params({}),
      ),
    );

    expect(status).toBe(422);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(body.error.details.shortfall).toBe(4);
  });

  it("returns 422 when a unit cannot be converted", async () => {
    const ingredient = await makeIngredient({ defaultUnit: "kg" });

    const { status, body } = await read(
      await movementsRoute.POST(
        json("/inventory/movements", "POST", {
          ingredientId: ingredient.id,
          type: "RECEIVE",
          quantity: 2,
          unit: "bunch",
        }),
        params({}),
      ),
    );

    expect(status).toBe(422);
    expect(body.error.code).toBe("UNCONVERTIBLE_UNIT");
  });
});

describe("query parameters", () => {
  it("filters ingredients by category", async () => {
    await makeIngredient({ name: "Chicken" });
    const listed = await read(
      await ingredientsRoute.GET(request("/ingredients?category=protein"), params({})),
    );
    expect(listed.body.data).toHaveLength(0);

    const all = await read(await ingredientsRoute.GET(request("/ingredients"), params({})));
    expect(all.body.data).toHaveLength(1);
  });

  it("rejects an unknown enum value in a query", async () => {
    const { status } = await read(
      await ingredientsRoute.GET(request("/ingredients?frequency=hourly"), params({})),
    );
    expect(status).toBe(400);
  });
});

describe("CSV export", () => {
  it("returns a downloadable file with the full column set", async () => {
    await makeIngredient({ name: "Baby spinach", quantity: 2, parLevel: 1 });

    const response = await csvRoute.GET(request("/inventory/export.csv"));
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(text).toContain("Ingredient");
    expect(text).toContain("Stock Status");
    expect(text).toContain("Baby spinach");
  });

  it("quotes cells so commas in notes cannot break the row", async () => {
    await makeIngredient({ name: "Salmon, sashimi-grade" });
    const text = await (await csvRoute.GET(request("/inventory/export.csv"))).text();
    expect(text).toContain('"Salmon, sashimi-grade"');
  });
});
