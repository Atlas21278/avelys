/**
 * Environment of the application under end-to-end test (VTC-048, docs/process/e2e.md).
 *
 * Every variable of the server schema is set explicitly here, so that nothing is picked up from
 * a developer's `.env` (Next.js never overrides a variable that is already set). The values are
 * fixed TEST-ONLY placeholders for a throwaway database: they are not secrets and are never used
 * outside the E2E run. Stripe keys of the fake mode are assembled at runtime, not written as
 * literals, so that secret scanners never mistake them for real keys.
 */

export type StripeMode = "fake" | "stripe-test";

/** Port of the application under test (3000 is often taken by `pnpm dev`). */
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

/** Port of the local fake Stripe API (`e2e/stubs/fake-stripe-server.ts`). */
export const FAKE_STRIPE_PORT = Number(process.env.E2E_FAKE_STRIPE_PORT ?? 12111);
export const FAKE_STRIPE_URL = `http://127.0.0.1:${FAKE_STRIPE_PORT}`;

/**
 * Dedicated E2E database: never the development database. Locally the docker compose
 * PostgreSQL (port 5433), in CI the job's service container (E2E_DATABASE_URL).
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://avelys:avelys_local@127.0.0.1:5433/avelys_e2e";

/** APP_ENV of the run: `ci` on GitHub Actions, `local` elsewhere (both allow the test switches). */
export const E2E_APP_ENV = process.env.CI ? "ci" : "local";

/** Fixed signing secret shared by the fake Stripe API and the app (fake mode only). */
export const FAKE_WEBHOOK_SECRET = ["whsec", "e2eFakeStripeSigningSecretNotASecret"].join("_");

const fakeStripeKeys = {
  STRIPE_SECRET_KEY: ["sk", "test", "e2eFakeStripeNotARealKey"].join("_"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ["pk", "test", "e2eFakeStripeNotARealKey"].join("_"),
  STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
  E2E_STRIPE_API_URL: FAKE_STRIPE_URL,
};

/**
 * Stripe test mode keys of the opt-in project, from the CI secrets (or the developer's shell):
 * `STRIPE_SECRET_KEY_TEST`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST`, and the signing secret
 * printed by `stripe listen --print-secret` in `STRIPE_WEBHOOK_SECRET_TEST`. Never logged.
 */
export function stripeTestModeKeys(): Record<string, string> | null {
  const secret = process.env.STRIPE_SECRET_KEY_TEST;
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST;
  const webhook = process.env.STRIPE_WEBHOOK_SECRET_TEST;
  if (!secret || !publishable || !webhook) return null;
  return {
    STRIPE_SECRET_KEY: secret,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishable,
    STRIPE_WEBHOOK_SECRET: webhook,
    E2E_STRIPE_API_URL: "",
  };
}

/** Variables shared by the app, the seed scripts and the database preparation. */
export function baseEnv(): Record<string, string> {
  return {
    APP_ENV: E2E_APP_ENV,
    APP_URL,
    DATABASE_URL: E2E_DATABASE_URL,
    // Test-only placeholders (>= 32 characters, distinct), never used outside the E2E database.
    BETTER_AUTH_SECRET: "e2e-tests-only-placeholder-not-a-secret-auth",
    PAYMENT_LINK_SECRET: "e2e-tests-only-placeholder-not-a-secret-link",
  };
}

/** Full environment of the application server for a Stripe mode. */
export function appEnv(mode: StripeMode): Record<string, string> {
  const stripe = mode === "fake" ? fakeStripeKeys : stripeTestModeKeys();
  return {
    ...baseEnv(),
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
    TRUSTED_PROXIES: "",
    AUTH_SESSION_MAX_AGE_SECONDS: "",
    // Public booking flow on (VTC-045), as in CI integration tests.
    PUBLIC_BOOKING_ENABLED: "true",
    // Maps: the fake routing table on the server, a placeholder browser key whose script is
    // replaced by Playwright (e2e/stubs/fake-places.js). Google is never called.
    E2E_FAKE_ROUTING: "true",
    GOOGLE_MAPS_SERVER_API_KEY: "",
    NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: "e2e-fake-maps-browser-key",
    ROUTING_SERVICE_AREA: "",
    BOOKING_MIN_LEAD_TIME_MINUTES: "",
    // No email is ever sent: without a key every email is traced FAILED (BR-50), bookings
    // are unaffected.
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    EMAIL_REPLY_TO: "",
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
    STRIPE_SECRET_KEY: "",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    E2E_STRIPE_API_URL: "",
    ...stripe,
  };
}
