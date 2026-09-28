/**
 * Development seed (VTC-025): `pnpm db:seed` (prisma db seed). Refused unless APP_ENV is
 * `local` or `ci` — never run in staging or production.
 *
 * Idempotent: publishes the provisional pricing rule only when no pricing rule exists yet.
 */
import "dotenv/config";

import { assertSeedAllowed } from "../src/server/seed-guard";

// Checked before anything touches the database.
try {
  assertSeedAllowed(process.env.APP_ENV);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Seed refused.");
  process.exit(1);
}

// Outside Next.js nothing sets NODE_ENV, which the environment schema requires.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "development";

/**
 * PROVISIONAL — DEC-03: starting values of the private pricing document (15 EUR pickup,
 * 1.50 EUR/km, 35 EUR minimum, TTC, half-up rounding, time floor disabled). Development data
 * only; real values are published as new versions once DEC-03 is decided.
 */
const PROVISIONAL_DEV_TARIFF = {
  currency: "EUR",
  amountBasis: "TTC",
  rounding: "halfUp",
  pickupCents: 1_500,
  perKmCents: 150,
  minimumCents: 3_500,
  timeFloor: null,
} as const;

/** Arbitrary past instant so that the rule is active immediately in development. */
const DEV_EFFECTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");

async function main() {
  // Imported after the environment is prepared: the modules validate it on first use.
  const { db } = await import("../src/server/db");
  const { createPricingRuleVersion } = await import("../src/server/pricing/rules");

  try {
    const existing = await db().pricingRule.count();
    if (existing > 0) {
      console.log(`Seed : ${existing} règle(s) tarifaire(s) déjà présente(s), rien à faire.`);
      return;
    }
    const rule = await createPricingRuleVersion(
      { effectiveFrom: DEV_EFFECTIVE_FROM, tariff: PROVISIONAL_DEV_TARIFF },
      { type: "SYSTEM" },
    );
    console.log(`Seed : règle tarifaire PROVISOIRE (DEC-03) créée, version ${rule.version}.`);
  } finally {
    await db().$disconnect();
  }
}

main().catch((error: unknown) => {
  // No raw message: it could carry connection details. Name and code are enough to diagnose.
  const name = error instanceof Error ? error.name : "UnknownError";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? ` (${String(error.code)})`
      : "";
  console.error(`Échec du seed : ${name}${code}.`);
  process.exit(1);
});
