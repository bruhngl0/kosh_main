import { z } from "zod";

/**
 * Validated environment. See docs/system-design.md §9.3.
 *
 * Resolved lazily and cached: reading `process.env` at module scope would make
 * a Vercel build fail before it ever reaches a request, and the build does not
 * need a database.
 */

const environmentSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection string."),
  DIRECT_URL: z.string().url("DIRECT_URL must be a valid connection string.").optional(),
  APP_URL: z.string().url("APP_URL must be a valid URL.").default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SEED_ON_DEPLOY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type Config = z.infer<typeof environmentSchema>;

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;

  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([key, messages]) => `  ${key}: ${messages?.join(", ")}`)
      .join("\n");
    // Fail loudly and specifically. A malformed connection string should not
    // surface later as an opaque socket error on the first request.
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  cached = parsed.data;
  return cached;
}

export const isProduction = () => config().NODE_ENV === "production";
export const isTest = () => config().NODE_ENV === "test";
