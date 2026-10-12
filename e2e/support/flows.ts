import { expect, type Locator, type Page } from "@playwright/test";

import type { StripeDriver } from "./stripe-driver";

/**
 * Steps of the customer and back-office journeys (VTC-048), written against the visible labels
 * and roles of the pages (French, the default locale), never against implementation details.
 */

/** A unique, non-routable test address per booking (RFC 2606 domain): no real person. */
export function testEmail(tag: string): string {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `e2e-${tag}-${unique}@example.com`;
}

/** Pickup date in Paris, `days` ahead (well past the 12 h minimum lead time). */
function parisDate(daysAhead: number): string {
  const day = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(day);
}

async function choosePlace(page: Page, field: string, query: string, suggestion: RegExp) {
  const combobox = page.getByRole("combobox", { name: field });
  await combobox.fill(query);
  await page.getByRole("option", { name: suggestion }).click();
  await expect(page.getByText("Lieu retenu.").first()).toBeVisible();
}

/** Step 1: a quote Opéra Garnier → CDG T2, three days ahead at 10:00 (Paris). Returns its total. */
export async function getQuote(page: Page): Promise<string> {
  await page.goto("/reservation");
  await choosePlace(page, "Départ", "Opéra", /Opéra Garnier/);
  await choosePlace(page, "Destination", "Charles de Gaulle", /Terminal 2/);
  await page.getByLabel("Date", { exact: true }).fill(parisDate(3));
  await page
    .getByLabel(/^Heure/)
    .first()
    .fill("10:00");
  await page.getByLabel("Passagers").fill("2");
  await page.getByLabel("Bagages").fill("1");
  await page.getByRole("button", { name: "Voir le prix" }).click();
  await expect(page.getByRole("heading", { name: "Votre demande" })).toBeVisible();
  const total = totalOf(page);
  await expect(total).toHaveText(/\d.*€/);
  return (await total.textContent())?.trim() ?? "";
}

/** The server total shown in the request step. */
function totalOf(page: Page): Locator {
  return page
    .locator("dt", { hasText: "Total de la demande, TTC" })
    .locator("xpath=following-sibling::dd[1]");
}

export type RequestOptions = {
  email: string;
  cardNumber: string;
  /** The card asks for 3-D Secure when it is saved. */
  setupAuthentication: boolean;
  /** Double click on « Envoyer ma demande » instead of a single click. */
  doubleClick?: boolean;
};

/** Step 2: contact, card through the Payment Element, terms, then the request. Returns the ref. */
export async function sendRequest(
  page: Page,
  stripe: StripeDriver,
  options: RequestOptions,
): Promise<string> {
  await page.getByLabel("Nom et prénom").fill("Client E2E");
  await page.getByRole("textbox", { name: /^Email/ }).fill(options.email);
  await page.getByRole("button", { name: "Saisir ma carte" }).click();
  await expect(page.getByText("Chargement du formulaire de carte…")).toBeHidden({
    timeout: 30_000,
  });
  await stripe.fillCard(page, options.cardNumber);
  await page.getByRole("checkbox", { name: /conditions générales de vente/ }).check();

  const submit = page.getByRole("button", { name: "Envoyer ma demande" });
  if (options.doubleClick) await submit.dblclick();
  else await submit.click();
  if (options.setupAuthentication) await stripe.authenticate(page, "complete");

  await expect(page.getByRole("heading", { name: "Demande envoyée" })).toBeVisible({
    timeout: 30_000,
  });
  const reference = page
    .locator("dt", { hasText: "Référence de votre demande" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(reference).toHaveText(/^[A-Z]+-[A-Z0-9]+$/);
  return (await reference.textContent())?.trim() ?? "";
}

/** One fact (`dt`/`dd`) of the « Paiement » section of the back-office detail. */
export function paymentFact(page: Page, label: string): Locator {
  return page
    .locator("section", { has: page.getByRole("heading", { name: "Paiement" }) })
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");
}

/** The booking status badge, next to the reference heading of the detail page. */
export function bookingStatus(page: Page, reference: string): Locator {
  return page
    .getByRole("heading", { name: reference, level: 1 })
    .locator("xpath=following-sibling::*[1]");
}

export async function openBooking(page: Page, reference: string): Promise<void> {
  await page.goto(`/admin/reservations/${reference}`);
  await expect(page.getByRole("heading", { name: reference, level: 1 })).toBeVisible();
}

/** Accept a `REQUESTED` booking, through the confirmation step, as the signed-in ADMIN. */
export async function acceptBooking(page: Page, reference: string): Promise<void> {
  await openBooking(page, reference);
  await expect(bookingStatus(page, reference)).toHaveText("À traiter");
  await page.getByRole("button", { name: "Accepter", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer l’acceptation" }).click();
  await expect(page.getByText("Demande acceptée.")).toBeVisible({ timeout: 30_000 });
}

/**
 * Waits for a status the webhooks set (asynchronous, BR-41): the detail page is reloaded until
 * the booking and the payment show the expected labels.
 */
export async function expectStatuses(
  page: Page,
  reference: string,
  expected: { booking: string; payment: string },
): Promise<void> {
  await expect(async () => {
    await openBooking(page, reference);
    await expect(bookingStatus(page, reference)).toHaveText(expected.booking, { timeout: 1_000 });
    await expect(paymentFact(page, "Statut")).toHaveText(expected.payment, { timeout: 1_000 });
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });
}
