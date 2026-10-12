/**
 * Creates the ADMIN account of the end-to-end suite and enrols its TOTP (VTC-048). Run by
 * `e2e/support/global-setup.ts` with `tsx --conditions=react-server`, on the E2E database only.
 *
 * Refused unless APP_ENV is `local` or `ci` (seed guard) and the database is a throwaway
 * `*_e2e` / `*_test` one. The account is recreated on each run (its sessions and 2FA rows go
 * with it), the auth rate-limit counters are cleared, then TOTP is enrolled through Better Auth
 * exactly like the setup page does. The only output is one JSON line with the otpauth URI, read
 * by the global setup: the secret of a test account of a test database, never logged elsewhere.
 */
import { assertSeedAllowed } from "../../src/server/seed-guard";

import { E2E_ADMIN } from "./admin";

assertSeedAllowed(process.env.APP_ENV);
const databaseName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!/_(e2e|test)$/.test(databaseName)) {
  console.error("seed-admin refused: not an *_e2e or *_test database");
  process.exit(1);
}

async function main() {
  // Imported after the guards: the modules validate the environment on first use.
  const { db } = await import("../../src/server/db");
  const { enrolTotp, signIn, staff, STAFF_PASSWORD } = await import("../../src/test/staff-session");
  if (STAFF_PASSWORD !== E2E_ADMIN.password) throw new Error("E2E admin password mismatch");
  try {
    await db().user.deleteMany({ where: { email: E2E_ADMIN.email } });
    await db().rateLimit.deleteMany({});
    await staff("ADMIN", E2E_ADMIN.email);
    const { jar } = await signIn(E2E_ADMIN.email);
    const totpUri = await enrolTotp(jar);
    // Drop the enrolment session: the browser signs in on its own.
    await db().session.deleteMany({ where: { user: { email: E2E_ADMIN.email } } });
    process.stdout.write(`${JSON.stringify({ totpUri })}\n`);
  } finally {
    await db().$disconnect();
  }
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`seed-admin failed: ${name}`);
  process.exit(1);
});
