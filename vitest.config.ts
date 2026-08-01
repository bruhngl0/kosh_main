import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Unit tests are pure and run everywhere. Integration and API tests need a
    // database and are opt-in via `npm run test:integration`.
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/modules/**/domain/**", "src/shared/**"],
      reporter: ["text", "html"],
    },
  },
});
