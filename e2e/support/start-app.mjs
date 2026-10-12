/**
 * Starts the production build of the application for the end-to-end suite (VTC-048), the way
 * the Docker image runs it (`output: "standalone"`, ADR-0013): `node .next/standalone/server.js`
 * with the static assets next to it. Requires `pnpm build` first. The environment comes from
 * Playwright's `webServer.env` (e2e/support/env.ts).
 */
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const standalone = `${root}.next/standalone`;

if (!existsSync(`${standalone}/server.js`)) {
  console.error("E2E: no production build found. Run `pnpm build` first (docs/process/e2e.md).");
  process.exit(1);
}

// The standalone output does not include the static assets nor `public/` (Next.js docs).
cpSync(`${root}.next/static`, `${standalone}/.next/static`, { recursive: true });
if (existsSync(`${root}public`))
  cpSync(`${root}public`, `${standalone}/public`, { recursive: true });

await import(pathToFileURL(`${standalone}/server.js`).href);
