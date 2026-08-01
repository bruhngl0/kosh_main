import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["next-env.d.ts", ".next/**", "node_modules/**", "coverage/**", "prisma/seed/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Architectural boundary from docs/system-design.md §4.1: the domain layer
    // is pure. Importing Prisma, the database, or Next into it is a defect.
    files: ["src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@prisma/client", "@/server/*", "next/*", "next"], message: "The domain layer must stay pure — no I/O, no framework. See docs/system-design.md §4.1." },
          ],
        },
      ],
    },
  },
  {
    // Route handlers are adapters: validate, call one use case, map errors.
    files: ["src/app/api/**/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/modules/*/infrastructure/*", "@/modules/*/application/*"], message: "Import a module's public barrel (@/modules/<name>), not its internals. See §4.3." },
          ],
        },
      ],
    },
  },
);
