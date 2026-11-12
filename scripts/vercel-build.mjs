// Vercel build entry point (vercel.json → buildCommand).
//
// Production builds apply pending migrations before building, using the
// DIRECT_URL stored in Vercel, so the schema is always in place before the
// code that needs it goes live. If a migration fails, the build fails and the
// current production deployment keeps serving. Preview builds have no
// database variables and skip this step.
/* global console */
import { execSync } from "node:child_process";
import process from "node:process";

const run = (command) => execSync(command, { stdio: "inherit" });

if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DIRECT_URL || !process.env.DATABASE_URL) {
    console.error("Production build needs DATABASE_URL and DIRECT_URL to apply migrations.");
    process.exit(1);
  }
  console.log("Applying database migrations (production)…");
  run("npx prisma migrate deploy");
} else {
  console.log(`Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
}

run("npx prisma generate");
run("npx next build");
