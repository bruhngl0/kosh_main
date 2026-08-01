import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z, ZodError, type ZodTypeAny } from "zod";
import { AppError, isAppError, type ErrorCode, type FieldErrors } from "@/server/errors";
import { resolveActor, type Actor } from "@/server/actor";

/**
 * HTTP adapter layer. See docs/system-design.md §7.
 *
 * Route handlers do four things and nothing else: parse, authorise, call one
 * use case, return. All of the plumbing for that lives here.
 *
 * Note on serialisation: Prisma `Decimal` values serialise to JSON strings via
 * their own `toJSON`. That is deliberate — quantities and money keep full
 * precision across the wire, and clients coerce explicitly.
 */

type Meta = Record<string, unknown>;

export function ok<T>(data: T, meta: Meta = {}, init?: ResponseInit) {
  return NextResponse.json({ data, meta }, init);
}

export function created<T>(data: T, meta: Meta = {}) {
  return ok(data, { ...meta, created: true }, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/** Everything a handler is given. `getActor` is lazy so reads skip the lookup. */
export type RouteContext<TParams> = {
  request: Request;
  params: TParams;
  url: URL;
  requestId: string;
  getActor: () => Promise<Actor>;
};

/**
 * Next's `typedRoutes` checker requires this to be a required parameter that
 * matches its generated `RouteContext`, so it is not optional here even though
 * static routes are invoked without it at runtime.
 */
type NextRouteArgs<TParams> = { params: Promise<TParams> };

/**
 * Wraps a handler with request-ID generation, param resolution, and the error
 * mapping in §7.1. Every route handler in the application is built with this.
 */
export function route<TParams = Record<string, never>>(
  handler: (context: RouteContext<TParams>) => Promise<Response>,
) {
  return async (request: Request, args: NextRouteArgs<TParams>): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const params = args?.params ? await args.params : ({} as TParams);
      let actorPromise: Promise<Actor> | undefined;
      const response = await handler({
        request,
        params,
        url: new URL(request.url),
        requestId,
        getActor: () => (actorPromise ??= resolveActor(request)),
      });
      return withRequestId(response, requestId);
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

/**
 * Stamps the request ID onto the response header and into `meta`.
 *
 * Done centrally rather than in `ok()` so no handler can forget it, and so the
 * §7 envelope contract holds for every route by construction. Only JSON bodies
 * are rewritten; file responses keep the header alone.
 */
async function withRequestId(response: Response, requestId: string): Promise<Response> {
  response.headers.set("x-request-id", requestId);

  if (!response.headers.get("content-type")?.includes("application/json")) return response;

  const payload = (await response.clone().json()) as { meta?: Record<string, unknown> };
  const body = { ...payload, meta: { ...payload.meta, requestId } };

  return new NextResponse(JSON.stringify(body), {
    status: response.status,
    headers: response.headers,
  });
}

// ── Input parsing ────────────────────────────────────────────────────────────

/**
 * Note the `ZodTypeAny` + `z.output` pattern rather than `ZodType<T>`: schemas
 * using `.default()` or `.transform()` have an input type that differs from
 * their output, and the single-generic form collapses the two.
 */
export async function parseBody<S extends ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  return parse(schema, raw);
}

export function parseParams<S extends ZodTypeAny>(params: unknown, schema: S): z.output<S> {
  return parse(schema, params);
}

export function parseQuery<S extends ZodTypeAny>(url: URL, schema: S): z.output<S> {
  // Repeated keys collapse to an array so `?week=1&week=2` is expressible.
  const entries: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    entries[key] = values.length > 1 ? values : values[0];
  }
  return parse(schema, entries);
}

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw validationError(result.error);
}

function validationError(error: ZodError) {
  const fields = error.flatten().fieldErrors as FieldErrors;
  const first = error.issues[0];
  return new AppError("VALIDATION_ERROR", first?.message ?? "Request validation failed.", { fields });
}

/** Path params arrive as strings; these keep that coercion in one place. */
export const uuidParam = z.string().uuid("Must be a valid identifier.");
export const intParam = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number.` }).int().positive();

// ── Error mapping ────────────────────────────────────────────────────────────

export function errorResponse(error: unknown, requestId: string): NextResponse {
  const mapped = toAppError(error);

  if (mapped.code === "INTERNAL_ERROR") {
    // Full detail to the log, nothing but a correlation ID to the client.
    console.error(
      JSON.stringify({
        level: "error",
        requestId,
        message: mapped.message,
        cause: serialiseCause(mapped.cause ?? error),
      }),
    );
  }

  return NextResponse.json(
    {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.fields ? { fields: mapped.fields } : {}),
        ...(mapped.details ? { details: mapped.details } : {}),
      },
      meta: { requestId },
    },
    { status: mapped.status, headers: { "x-request-id": requestId } },
  );
}

/**
 * Collapses every error source into the §7.1 taxonomy. Prisma's known error
 * codes carry real meaning and must not all become 500s.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof ZodError) return validationError(error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2025":
        return new AppError("NOT_FOUND", "The requested record does not exist.", { cause: error });
      case "P2002": {
        const target = normaliseTarget(error.meta?.target);
        return new AppError(
          "CONFLICT",
          target ? `A record with that ${target} already exists.` : "That record already exists.",
          { details: target ? { constraint: target } : undefined, cause: error },
        );
      }
      case "P2003":
        return new AppError("VALIDATION_ERROR", "A referenced record does not exist.", { cause: error });
      case "P2014":
        return new AppError("CONFLICT", "That change would break a required relation.", { cause: error });
      default:
        return internal(error);
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return internal(error, "Malformed database query.");
  }

  return internal(error);
}

function internal(cause: unknown, message = "Unexpected server error.") {
  return new AppError("INTERNAL_ERROR", message, { cause });
}

function normaliseTarget(target: unknown): string | undefined {
  if (Array.isArray(target)) return target.join(", ");
  if (typeof target === "string") return target;
  return undefined;
}

function serialiseCause(cause: unknown) {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return cause;
}

/** Re-exported so route files import a single module. */
export type { ErrorCode };
export { AppError };
