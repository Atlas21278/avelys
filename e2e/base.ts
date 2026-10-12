import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { FAKE_PLACES } from "../src/integrations/maps/fake-places";
import { FAKE_STRIPE_URL, type StripeMode } from "./support/env";

/**
 * Fixtures of the end-to-end suite (VTC-048, docs/process/e2e.md).
 *
 * Every browser context gets the network stubs before any page loads:
 * - Maps: the Maps JavaScript API script is answered by `stubs/fake-places.js`; any other request
 *   to a Google Maps Platform host is aborted and reported, so a test fails if the app ever tries
 *   to call Google Maps (no billed call, ever);
 * - Stripe, fake mode only: `https://js.stripe.com/*` is answered by `stubs/fake-stripe.js`, which
 *   talks to the local fake Stripe API; any other Stripe host is aborted and reported. In the
 *   `stripe-test` mode the real Stripe.js and Stripe test mode are used.
 */

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./stubs/${name}`, import.meta.url)), "utf8");

const fakePlacesScript = `window.__AVELYS_FAKE_PLACES__ = ${JSON.stringify(FAKE_PLACES)};\n${read("fake-places.js")}`;
const fakeStripeScript = `window.__AVELYS_FAKE_STRIPE_API__ = ${JSON.stringify(FAKE_STRIPE_URL)};\n${read("fake-stripe.js")}`;

/** Google Maps Platform hosts (Maps JavaScript API, Places, Routes, tiles and assets). */
const GOOGLE_HOSTS =
  /^https?:\/\/(maps|places|routes)\.googleapis\.com\/|^https?:\/\/maps\.gstatic\.com\//;
const MAPS_SCRIPT = /^https:\/\/maps\.googleapis\.com\/maps\/api\/js(\?|$)/;
const STRIPE_HOSTS = /^https?:\/\/([a-z0-9-]+\.)*(stripe\.com|stripe\.network)\//;
const STRIPE_JS = /^https:\/\/js\.stripe\.com\//;

/** Requests the stubs refused: must stay empty (checked after each test). */
export type BlockedRequests = string[];

export async function installStubs(
  context: BrowserContext,
  mode: StripeMode,
  blocked: BlockedRequests,
): Promise<void> {
  // Routes are matched last-registered first: the catch-alls are registered before the stubs.
  await context.route(GOOGLE_HOSTS, (route) => {
    blocked.push(new URL(route.request().url()).host);
    return route.abort("blockedbyclient");
  });
  await context.route(MAPS_SCRIPT, (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakePlacesScript }),
  );
  if (mode === "fake") {
    await context.route(STRIPE_HOSTS, (route) => {
      blocked.push(new URL(route.request().url()).host);
      return route.abort("blockedbyclient");
    });
    await context.route(STRIPE_JS, (route) =>
      route.fulfill({ contentType: "text/javascript", body: fakeStripeScript }),
    );
  }
}

/** Where the admin's signed-in browser state is kept (git-ignored, never uploaded). */
export const ADMIN_STATE = fileURLToPath(new URL("./.auth/admin.json", import.meta.url));

type Fixtures = {
  /** Requests refused by the stubs during the test. */
  blockedRequests: BlockedRequests;
  /** A signed-in ADMIN (2FA done by the setup project), in its own browser context. */
  adminPage: Page;
};

type Options = {
  /** `fake` (default): local fake Stripe. `stripe-test`: real Stripe test mode (opt-in). */
  stripeMode: StripeMode;
};

async function adminContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({
    baseURL,
    storageState: ADMIN_STATE,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // The copy button of the regularisation link writes to the clipboard (VTC-042).
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

export const test = base.extend<Fixtures & Options>({
  stripeMode: ["fake", { option: true }],

  blockedRequests: async ({}, use) => {
    const blocked: BlockedRequests = [];
    await use(blocked);
    expect(blocked, "requests to Google or Stripe hosts that the stubs refused").toEqual([]);
  },

  context: async ({ context, stripeMode, blockedRequests }, use) => {
    await installStubs(context, stripeMode, blockedRequests);
    await use(context);
  },

  adminPage: async ({ browser, baseURL, stripeMode, blockedRequests }, use) => {
    const context = await adminContext(browser, baseURL);
    await installStubs(context, stripeMode, blockedRequests);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
