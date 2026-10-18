import { defineConfig } from "prisma/config";

// Load app/.env for the Prisma CLI when present. In CI and hosting the
// variables come from the environment instead.
try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
