"use client";

/**
 * Browser-side API client.
 *
 * Every component previously hand-rolled `fetch` + `response.ok` + digging for
 * `body.error.message`, and most of them silently ignored failures. This is the
 * one place the §7 envelope is unwrapped, so a failed mutation always surfaces
 * a usable message instead of nothing happening.
 */

export type ApiErrorBody = {
  code: string;
  message: string;
  fields?: Record<string, string[] | undefined>;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string[] | undefined>;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
    this.details = body.details;
  }
}

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    // Network failure, not an API response.
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "Could not reach the server." });
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? { code: "INTERNAL_ERROR", message: "Unexpected server error." },
    );
  }

  return payload?.data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Turns any thrown value into something worth showing a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fieldMessage = error.fields && Object.values(error.fields).flat().filter(Boolean)[0];
    return fieldMessage ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
