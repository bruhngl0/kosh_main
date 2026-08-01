import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration and API tests. These need a live PostgreSQL database and run
 * serially, because they truncate shared tables between cases.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts", "tests/api/**/*.test.ts"],
    setupFiles: ["tests/support/setup-database.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
