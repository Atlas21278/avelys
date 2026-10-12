import { createRequire } from "node:module";

import { defineConfig, devices } from "@playwright/test";

import {
  APP_URL,
  appEnv,
  FAKE_STRIPE_PORT,
  FAKE_STRIPE_URL,
  FAKE_WEBHOOK_SECRET,
  stripeTestModeKeys,
  type StripeMode,
} from "./env";

/**
 * Playwright configuration shared by the two E2E entry points (VTC-048, docs/process/e2e.md):
 * `playwright.config.ts` (fake Stripe, `pnpm test:e2e`, always) and
 * `playwright.stripe.config.ts` (Stripe test mode, `pnpm test:e2e:stripe`, opt-in).
 *
 * One worker, no retry: the scenarios share one database and one admin, and a flaky scenario
 * must fail rather than pass on a second try. Traces and screenshots are kept on failure only;
 * they hold test data only (example.com addresses, test cards, a throwaway database).
 */

const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");
const CI = Boolean(process.env.CI);

export function e2eConfig(mode: StripeMode) {
  // The opt-in project without its keys: nothing is started, every scenario reports "skipped".
  const runnable = mode === "fake" || stripeTestModeKeys() !== null;

  const app = {
    command: "node e2e/support/start-app.mjs",
    url: `${APP_URL}/api/health`,
    env: appEnv(mode),
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  };
  const fakeStripe = {
    command: `node "${tsx}" e2e/stubs/fake-stripe-server.ts`,
    url: `${FAKE_STRIPE_URL}/e2e/health`,
    env: {
      FAKE_STRIPE_PORT: String(FAKE_STRIPE_PORT),
      FAKE_STRIPE_WEBHOOK_URL: `${APP_URL}/api/webhooks/stripe`,
      FAKE_STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
    },
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  };

  return defineConfig<{ stripeMode: StripeMode }>({
    testDir: "./e2e",
    outputDir: `test-results/e2e-${mode}`,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: CI,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    reporter: CI
      ? [
          ["github"],
          ["list"],
          ["html", { open: "never", outputFolder: `playwright-report/${mode}` }],
          ["junit", { outputFile: `reports/e2e-${mode}.xml` }],
        ]
      : [["list"], ["html", { open: "never", outputFolder: `playwright-report/${mode}` }]],
    globalSetup: runnable ? "./e2e/support/global-setup.ts" : undefined,
    webServer: runnable ? (mode === "fake" ? [fakeStripe, app] : [app]) : undefined,
    use: {
      baseURL: APP_URL,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      // Stripe test mode: no trace (it would record Stripe.js traffic of the test account);
      // screenshots only.
      trace: mode === "fake" ? "retain-on-failure" : "off",
      screenshot: "only-on-failure",
      video: "off",
    },
    projects: [
      { name: `setup-${mode}`, testMatch: /admin\.setup\.ts$/ },
      {
        name: mode,
        testMatch: /\.spec\.ts$/,
        dependencies: [`setup-${mode}`],
        use: { ...devices["Desktop Chrome"], stripeMode: mode },
      },
    ],
  });
}
