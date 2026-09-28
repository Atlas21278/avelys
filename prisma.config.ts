import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Development data only (PROVISIONAL — DEC-03); refused unless APP_ENV is local or ci.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    // Read directly rather than with prisma's env(): `prisma generate` (install, Docker build)
    // needs no database, while migrate commands still fail loudly when the URL is missing.
    url: process.env.DATABASE_URL ?? "",
  },
});
