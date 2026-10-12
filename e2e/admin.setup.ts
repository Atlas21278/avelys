import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { totpFromUri } from "../src/test/totp";
import { ADMIN_STATE } from "./base";
import { ADMIN_TOTP_URI_VARIABLE, E2E_ADMIN } from "./support/admin";

/**
 * Back-office sign-in of the E2E admin (VTC-048, VTC-016): email + password, then the 6-digit
 * TOTP computed by the test from the secret enrolled by the global setup, as an authenticator
 * app would. The signed-in state is saved for the scenarios (e2e/.auth, git-ignored).
 */
setup("l'admin se connecte avec mot de passe et code TOTP", async ({ page }) => {
  const totpUri = process.env[ADMIN_TOTP_URI_VARIABLE];
  setup.skip(!totpUri, "no E2E database prepared (opt-in Stripe test mode project without keys)");
  if (!totpUri) return;

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
