import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { totpFromUri } from "../src/test/totp";
import { ADMIN_STATE } from "./base";
import { ADMIN_TOTP_URI_VARIABLE, E2E_ADMIN } from "./support/admin";
import { stripeTestModeKeys } from "./support/env";

/**
 * Back-office sign-in of the E2E admin (VTC-048, VTC-016): email + password, then the 6-digit
 * TOTP computed by the test from the secret enrolled by the global setup, as an authenticator
 * app would. The signed-in state is saved for the scenarios (e2e/.auth, git-ignored).
 */
setup("l'admin se connecte avec mot de passe et code TOTP", async ({ page }, testInfo) => {
  const totpUri = process.env[ADMIN_TOTP_URI_VARIABLE];
  // Only the opt-in Stripe test mode project without its keys prepares nothing (every scenario
  // is then skipped). Anywhere else a missing URI means the global setup failed: fail loudly.
  const optInWithoutKeys =
    testInfo.project.name === "setup-stripe-test" && stripeTestModeKeys() === null;
  setup.skip(optInWithoutKeys, "Stripe test mode keys absent: opt-in project not run");
  if (!totpUri) throw new Error(`${ADMIN_TOTP_URI_VARIABLE} missing: the global setup did not run`);

  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Mot de passe").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/admin/two-factor");

  // A code about to expire may reach the server in the next 30 s window: wait for a fresh one.
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsLeft < 5) await page.waitForTimeout(secondsLeft * 1000 + 500);
  await page.getByLabel("Code à 6 chiffres").fill(totpFromUri(totpUri));
  await page.getByRole("button", { name: "Valider" }).click();

  await page.waitForURL(/\/admin$/);
  await expect(page.getByText("Rôle : Administrateur")).toBeVisible();

  mkdirSync(dirname(ADMIN_STATE), { recursive: true });
  await page.context().storageState({ path: ADMIN_STATE });
});
