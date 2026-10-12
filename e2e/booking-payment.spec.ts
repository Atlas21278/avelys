import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { chargedAmounts, countBookingsForEmail } from "./support/db";
import { stripeTestModeKeys, type StripeMode } from "./support/env";
import {
  acceptBooking,
  expectStatuses,
  getQuote,
  openBooking,
  paymentFact,
  sendRequest,
  testEmail,
} from "./support/flows";
import { stripePaymentIntentAmount } from "./support/stripe-amount";
import { stripeDriver } from "./support/stripe-driver";
import { TEST_CARDS } from "./stubs/cards";

/**
 * Critical journey (VTC-048, ADR-0012): quote → booking request → admin acceptance → test
 * payment, plus the SCA regularisation (VTC-042) and the double submission (VTC-047).
 *
 * The same scenarios run against the local fake Stripe (`pnpm test:e2e`, always) and, opt-in,
 * against Stripe test mode (`pnpm test:e2e:stripe`). The opt-in project is reported as skipped
 * when its keys are absent: the fake project, which covers the same scenarios, still runs.
 */
test.skip(
  ({ stripeMode }) => stripeMode === "stripe-test" && stripeTestModeKeys() === null,
  "Stripe test mode keys absent: opt-in project not run (docs/process/e2e.md)",
);

/** Amounts as digits only: the two pages format the same integer cents. */
const digits = (text: string | null) => (text ?? "").replace(/\D/g, "");

async function expectAmount(adminPage: Page, total: string) {
  await expect(paymentFact(adminPage, "Montant")).toHaveText(/\d/);
  expect(digits(await paymentFact(adminPage, "Montant").textContent())).toBe(digits(total));
}

/**
 * The amount Stripe was asked to take is the server quote, in integer cents (BR-10, BR-12): the
 * PaymentIntent held by Stripe (fake or test mode) = the Payment row = the booking's frozen TTC
 * total = the price the visitor was shown.
 */
async function expectChargedQuote(mode: StripeMode, reference: string, shownTotal: string) {
  const amounts = await chargedAmounts(reference);
  expect(amounts.stripePaymentIntentId).toMatch(/^pi_/);
  const intent = await stripePaymentIntentAmount(mode, amounts.stripePaymentIntentId ?? "");
  expect(Number.isInteger(amounts.bookingTotalTtcCents)).toBe(true);
  expect(intent).toEqual({
    amount: amounts.bookingTotalTtcCents,
    currency: amounts.bookingCurrency,
  });
  expect(amounts.paymentAmountCents).toBe(amounts.bookingTotalTtcCents);
  expect(amounts.paymentCurrency).toBe(amounts.bookingCurrency);
  expect(String(amounts.bookingTotalTtcCents)).toBe(digits(shownTotal));
}

test("scénario 1 : débit hors session réussi à l'acceptation → Payé, Confirmée", async ({
  page,
  adminPage,
  stripeMode,
}) => {
  const card = TEST_CARDS.success;
  const total = await getQuote(page);
  const reference = await sendRequest(page, stripeDriver(stripeMode), {
    email: testEmail("success"),
    cardNumber: card.number,
    setupAuthentication: card.setupAuthentication,
  });

  // The request waits for the admin: nothing is charged before acceptance (ADR-0006).
  await openBooking(adminPage, reference);
  await expect(paymentFact(adminPage, "Statut")).toHaveText("En attente");
  await expectAmount(adminPage, total);

  await acceptBooking(adminPage, reference);
  await expectStatuses(adminPage, reference, { booking: "Confirmée", payment: "Payé" });
  await expect(paymentFact(adminPage, "Tentative de débit")).toHaveText("n° 1");
  await expectAmount(adminPage, total);
  await expectChargedQuote(stripeMode, reference, total);
});

test("scénario 1 bis : carte authentifiée à l'enregistrement, débit hors session réussi", async ({
  page,
  adminPage,
  stripeMode,
}) => {
  const card = TEST_CARDS.authenticateOnSetup;
  const total = await getQuote(page);
  const reference = await sendRequest(page, stripeDriver(stripeMode), {
    email: testEmail("setup-sca"),
    cardNumber: card.number,
    setupAuthentication: card.setupAuthentication,
  });

  await acceptBooking(adminPage, reference);
  await expectStatuses(adminPage, reference, { booking: "Confirmée", payment: "Payé" });
  await expectChargedQuote(stripeMode, reference, total);
});

test("scénario 2 : SCA → authentification requise, lien de régularisation → Confirmée", async ({
  browser,
  page,
  adminPage,
  stripeMode,
}) => {
  const stripe = stripeDriver(stripeMode);
  const card = TEST_CARDS.alwaysAuthenticate;
  const total = await getQuote(page);
  const reference = await sendRequest(page, stripe, {
    email: testEmail("sca"),
    cardNumber: card.number,
    setupAuthentication: card.setupAuthentication,
  });

  // The off-session charge asks for authentication: the booking stays accepted (BR-41).
  await acceptBooking(adminPage, reference);
  await expectStatuses(adminPage, reference, {
    booking: "Acceptée",
    payment: "Authentification client requise",
  });

  // The admin copies the signed link from the detail (VTC-042).
  const linkField = adminPage.getByRole("textbox", { name: "Lien de régularisation" });
  const link = await linkField.inputValue();
  expect(link).toMatch(/\/paiement\/[^/]+$/);
  await adminPage.getByRole("button", { name: "Copier le lien de régularisation" }).click();
  await expect(adminPage.getByText("Lien copié.")).toBeVisible();
  expect(await adminPage.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // The customer opens it in the browser they booked with and authenticates on Stripe's page.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Finaliser votre paiement" })).toBeVisible();
  expect(digits(await page.locator("dd").filter({ hasText: "€" }).first().textContent())).toBe(
    digits(total),
  );
  await page.getByRole("button", { name: "Authentifier le paiement" }).click();
  await stripe.authenticate(page, "complete");
  await expect(page.getByRole("heading", { name: "Paiement reçu" })).toBeVisible({
    timeout: 30_000,
  });

  // The webhook confirms the booking; the page itself never writes a status.
  await expectStatuses(adminPage, reference, { booking: "Confirmée", payment: "Payé" });
  await expectChargedQuote(stripeMode, reference, total);

  // Once paid, the link no longer offers a payment: a fresh visitor gets the generic 404.
  const stranger = await browser.newPage();
  await stranger.goto(link);
  await expect(stranger.getByRole("heading", { name: "Lien invalide ou expiré" })).toBeVisible();
  await stranger.close();
});

test("scénario 3 : double clic sur l'envoi → une seule réservation", async ({
  page,
  adminPage,
  stripeMode,
}) => {
  const card = TEST_CARDS.success;
  const email = testEmail("double-click");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/bookings") {
      posts.push(request.url());
    }
  });

  await getQuote(page);
  const reference = await sendRequest(page, stripeDriver(stripeMode), {
    email,
    cardNumber: card.number,
    setupAuthentication: card.setupAuthentication,
    doubleClick: true,
  });

  expect(posts).toHaveLength(1);
  expect(await countBookingsForEmail(email)).toBe(1);
  await openBooking(adminPage, reference);
  await expect(paymentFact(adminPage, "Statut")).toHaveText("En attente");
});
