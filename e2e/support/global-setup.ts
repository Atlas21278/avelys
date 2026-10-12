/**
 * Prepares the E2E database before the tests (VTC-048, docs/process/e2e.md): creates it when
 * missing (local docker compose), applies the migrations, publishes the provisional development
 * pricing rule (`prisma db seed`, refused outside APP_ENV local/ci) and creates the E2E admin
 * with a freshly enrolled TOTP secret (`e2e/support/seed-admin.ts`). The otpauth URI is handed to
 * the tests through this process's environment only: never written to disk, never logged.
 *
 * Refuses any database whose name does not end with `_e2e` or `_test`.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { ADMIN_TOTP_URI_VARIABLE } from "./admin";
import { baseEnv, E2E_DATABASE_URL } from "./env";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

function assertThrowawayDatabase(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+_(e2e|test)$/.test(name)) {
    throw new Error(`E2E refused: database "${name}" is not a throwaway *_e2e or *_test database`);
  }
  return name;
}

async function ensureDatabase(): Promise<void> {
  const url = new URL(E2E_DATABASE_URL);
  const name = assertThrowawayDatabase(url);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    // The name is validated above ([a-z0-9_]): safe to quote as an identifier.
    if (found.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

function node(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export default async function globalSetup(): Promise<void> {
  await ensureDatabase();
  // Scripts run outside Next.js: NODE_ENV must be set for the environment schema.
  // Silent logs: the admin seed's only stdout line is the JSON read below.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...baseEnv(),
    NODE_ENV: "development",
    LOG_LEVEL: "silent",
  };
  const prisma = `${root}node_modules/prisma/build/index.js`;
  const tsx = require.resolve("tsx/cli");

  node([prisma, "migrate", "deploy"], env);
  node([prisma, "db", "seed"], env);
  const output = node(
    [tsx, "--conditions=react-server", `${root}e2e/support/seed-admin.ts`],
    env,
  ).trim();
  const last = output.split("\n").at(-1) ?? "";
  const { totpUri } = JSON.parse(last) as { totpUri?: string };
  if (!totpUri) throw new Error("E2E: the admin TOTP enrolment returned no URI");
  process.env[ADMIN_TOTP_URI_VARIABLE] = totpUri;
}
