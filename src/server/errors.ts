/**
 * Error taxonomy. See docs/system-design.md §7.1.
 *
 * Every foreseeable failure gets a code here. Anything that reaches the client
 * as INTERNAL_ERROR is a defect, not a user-facing condition.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "UNPROCESSABLE"
  | "INSUFFICIENT_STOCK"
  | "UNCONVERTIBLE_UNIT"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  UNPROCESSABLE: 422,
  INSUFFICIENT_STOCK: 422,
  UNCONVERTIBLE_UNIT: 422,
  INTERNAL_ERROR: 500,
};

/** Field-scoped validation messages, matching Zod's `flatten().fieldErrors`. */
export type FieldErrors = Record<string, string[] | undefined>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly fields?: FieldErrors;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; fields?: FieldErrors; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.fields = options.fields;
  }
}

export const notFound = (entity: string, id?: string) =>
  new AppError("NOT_FOUND", id ? `${entity} ${id} was not found.` : `${entity} was not found.`, {
    details: { entity, id },
  });

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("CONFLICT", message, { details });

export const unprocessable = (message: string, details?: Record<string, unknown>) =>
  new AppError("UNPROCESSABLE", message, { details });

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", message);

/** BR-12: an illegal move through a lifecycle state machine. */
export const invalidTransition = (entity: string, from: string, to: string, allowed: readonly string[]) =>
  new AppError("INVALID_TRANSITION", `${entity} cannot move from ${from} to ${to}.`, {
    details: { entity, from, to, allowed },
  });

/** BR-10: a movement would drive a balance below zero. */
export const insufficientStock = (input: {
  ingredientId: string;
  ingredientName: string;
  available: number;
  requested: number;
  unit: string;
}) =>
  new AppError(
    "INSUFFICIENT_STOCK",
    `${input.ingredientName} has ${input.available} ${input.unit} available but ${input.requested} ${input.unit} was requested.`,
    { details: { ...input, shortfall: Number((input.requested - input.available).toFixed(3)) } },
  );

/** §6.2: a quantity cannot be expressed in the target unit. */
export const unconvertibleUnit = (input: {
  ingredientId?: string;
  ingredientName: string;
  from: string;
  to: string;
}) =>
  new AppError(
    "UNCONVERTIBLE_UNIT",
    `${input.ingredientName} is measured in "${input.from}" which cannot be converted to "${input.to}".`,
    { details: input },
  );

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
