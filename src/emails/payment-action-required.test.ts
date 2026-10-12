import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { Locale } from "@/i18n/routing";

import {
  PaymentActionRequiredEmail,
  paymentActionRequiredSubject,
  type PaymentActionRequiredEmailProps,
} from "./payment-action-required";
import { renderEmail } from "./render";

// Test-only values: not a tariff, not a real link.
const PROPS = {
  bookingReference: "AVL-7K4P-2Q9M",
  // 10:00 in Paris (winter time, UTC+1).
  pickupAt: new Date("2026-11-02T09:00:00Z"),
  amountCents: 4_125,
  currency: "EUR",
} as const;

function props(locale: Locale): PaymentActionRequiredEmailProps {
  const prefix = locale === "fr" ? "" : "/en";
  const path = locale === "fr" ? "/paiement/" : "/payment/";
  return {
    ...PROPS,
    locale,
    paymentUrl: `https://avelys.example${prefix}${path}TestToken_123`,
    contactUrl: `https://avelys.example${prefix}/contact`,
  };
}

const render = (locale: Locale) =>
  renderEmail(createElement(PaymentActionRequiredEmail, props(locale)));

/** Body of the plain text, without the layout footer (covered by layout.test.ts). */
function body(text: string): string {
  return text.slice(0, text.indexOf("----------------------------------------")).trim();
}

describe("PaymentActionRequiredEmail", () => {
  it("renders the French email", async () => {
    const { html, text } = await render("fr");
    expect(html).toContain('lang="fr"');
    expect(html).toContain('href="https://avelys.example/paiement/TestToken_123"');
    expect(html).toContain('href="https://avelys.example/contact"');
    expect(body(text)).toMatchInlineSnapshot(`
      "Avelys


      AUTHENTIFICATION DU PAIEMENT REQUISE

      Votre banque demande une authentification pour régler votre course. Le montant est celui de votre réservation.

      Votre course

      Référence
      AVL-7K4P-2Q9M

      Prise en charge
      lundi 2 novembre 2026 à 10:00 (heure de Paris)

      Montant TTC
      41,25 €

      Le bouton ouvre la page sécurisée où votre banque vous demande de valider le paiement avec la carte enregistrée lors de votre demande. Aucune nouvelle carte n’est demandée.

      Authentifier le paiement https://avelys.example/paiement/TestToken_123

      Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :

      https://avelys.example/paiement/TestToken_123

      Votre réservation sera confirmée une fois le paiement validé. Si vous avez déjà finalisé votre paiement, vous n’avez rien d’autre à faire.

      Une question ? Nous contacter https://avelys.example/contact"
    `);
  });

  it("renders the English email", async () => {
    const { html, text } = await render("en");
    expect(html).toContain('lang="en"');
    expect(html).toContain('href="https://avelys.example/en/payment/TestToken_123"');
    expect(html).toContain('href="https://avelys.example/en/contact"');
    expect(body(text)).toMatchInlineSnapshot(`
      "Avelys


      PAYMENT AUTHENTICATION REQUIRED

      Your bank asks for authentication to pay for your ride. The amount is the one of your booking.

      Your ride

      Reference
      AVL-7K4P-2Q9M

      Pick-up
      Monday, November 2, 2026 at 10:00 AM (Paris time)

      Total incl. VAT
      €41.25

      The button opens the secure page where your bank asks you to approve the payment with the card saved with your request. No new card is asked for.

      Authenticate the payment https://avelys.example/en/payment/TestToken_123

      If the button does not work, copy this link into your browser:

      https://avelys.example/en/payment/TestToken_123

      Your booking will be confirmed once the payment is approved. If you have already completed your payment, there is nothing else to do.

      A question? Contact us https://avelys.example/en/contact"
    `);
  });

  it("renders identically twice (deterministic for a deduplication key)", async () => {
    const first = await render("fr");
    const second = await render("fr");
    expect(second).toEqual(first);
  });

  it("states no deadline, refund, cancellation condition or personal data", async () => {
    for (const locale of ["fr", "en"] as const) {
      const { text } = await render(locale);
      const content = body(text).toLowerCase();
      for (const word of [
        "rembours",
        "refund",
        "annul",
        "cancel",
        "délai",
        "deadline",
        "avant le",
        "before",
        "expire",
        "heures",
        "hours",
        "@",
      ]) {
        expect(content, `${locale}: ${word}`).not.toContain(word);
      }
    }
  });

  it("builds the subject with the reference", () => {
    expect(paymentActionRequiredSubject("fr", PROPS.bookingReference)).toBe(
      "Authentification requise pour le paiement de votre course AVL-7K4P-2Q9M",
    );
    expect(paymentActionRequiredSubject("en", PROPS.bookingReference)).toBe(
      "Authentication required to pay for your ride AVL-7K4P-2Q9M",
    );
  });
});
