import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PROVISIONAL_SERVICE_AREA } from "@/domain/geo/service-area";
import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";
import { quoteFingerprint } from "@/lib/booking-quote";
import { money } from "@/lib/money";
import type { RetainedQuote } from "@/lib/quote-step-state";
import { createRequestStore } from "@/lib/request-step-flow";
import { initialRequestStepState, type RequestStepAction } from "@/lib/request-step-state";

// The navigation Link needs the Next.js router; a plain anchor is enough for markup checks.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
// Stripe.js must never be fetched by rendering the step: only the card step loads it.
const loadStripe = vi.fn();
vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: (key: string) => loadStripe(key) }));

const { RequestSent, RequestStep, RequestUnavailable } = await import("./request-step");
const { BookingFlow } = await import("./booking-flow");

function render(element: ReactElement, locale: "fr" | "en" = "fr") {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: locale === "fr" ? fr : en,
        timeZone: "Europe/Paris",
      } as ComponentProps<typeof NextIntlClientProvider>,
      element,
    ),
  );
}

const REQUEST = {
  origin: { placeId: "test-place-origin", label: "Test origin" },
  destination: { placeId: "test-place-destination", label: "Test destination" },
  pickupLocalDateTime: "2026-10-25T14:30",
  passengers: 2,
  luggage: 1,
};
const DISPLAY = {
  snapshotId: "a".repeat(64),
  total: money(4852),
  totalHt: null,
  vat: null,
  distanceMeters: 22_345,
  durationSeconds: 1_800,
  pickupAt: "2026-10-25T13:30:00.000Z",
  pickupLocalDateTime: "2026-10-25T14:30",
  timeZone: "Europe/Paris",
  pricingRuleVersion: 3,
};
const QUOTE: RetainedQuote = {
  request: REQUEST,
  quote: DISPLAY,
  fingerprint: quoteFingerprint(REQUEST, DISPLAY),
};
const KEY = `pk_test_${"A1b2".repeat(6)}`;

function step(locale: "fr" | "en" = "fr", ...actions: RequestStepAction[]) {
  const store = createRequestStore(initialRequestStepState("id-0"));
  store.dispatch({ type: "quote", fingerprint: QUOTE.fingerprint, submissionId: "id-1" });
  for (const action of actions) store.dispatch(action);
  return render(
    createElement(RequestStep, { quote: QUOTE, store, stripePublishableKey: KEY, locale }),
    locale,
  );
}

describe("RequestStep markup", () => {
  const html = step();

  it("labels every contact field and marks the optional ones", () => {
    for (const label of ["Nom et prénom", "Email", "Téléphone", "Précisions utiles"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("(facultatif)");
    expect(html).toMatch(/<textarea[^>]*id="[^"]+"/);
  });

  it("links the terms checkbox to the existing provisional CGV page", () => {
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain('href="/cgv"');
    expect(html).toContain("conditions générales de vente");
  });

  it("shows the server total, formatted, and no Payment Element before the card step", () => {
    expect(html).toContain("48,52");
    expect(html).toContain("Saisir ma carte");
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it("offers the new server price for an explicit confirmation after PRICE_CHANGED", () => {
    const changed = step(
      "fr",
      { type: "field", field: "email", value: "guest@avelys.test", submissionId: "id-2" },
      { type: "setupStarted", epoch: 1, email: "guest@avelys.test" },
      { type: "setupCreated", epoch: 1, clientSecret: "seti_1_secret_x" },
      { type: "submitStarted", epoch: 1, acceptPrice: false },
      { type: "cardSaved", epoch: 1, paymentSetupId: "seti_1" },
      {
        type: "submitFailed",
        epoch: 1,
        failure: "priceChanged",
        total: money(5100),
        submissionId: "n",
      },
    );
    expect(changed).toContain("Le prix a changé");
    expect(changed).toContain("51,00");
    expect(changed).toContain("Accepter le nouveau prix et envoyer");
    expect(changed).not.toContain("Envoyer ma demande<");
    expect(changed).toContain("Carte enregistrée");
    // The email is locked to the saved card.
    expect(changed).toMatch(/<input[^>]*type="email"[^>]*readOnly=""/i);
  });

  it("renders in English", () => {
    const english = step("en");
    expect(english).toContain("Send my request");
    expect(english).toContain("terms and conditions of sale");
    expect(english).toContain("€48.52");
  });
});

describe("RequestSent", () => {
  it("shows the reference and the no-charge reminder as provisional text", () => {
    const html = render(createElement(RequestSent, { reference: "VTC-AB12CD34" }));
    expect(html).toContain("VTC-AB12CD34");
    expect(html).toContain("Aucun montant n’est débité avant son acceptation.");
    expect(html).toContain("data-provisional");
  });
});

describe("RequestUnavailable", () => {
  it("offers contact instead of a card step", () => {
    const html = render(createElement(RequestUnavailable), "en");
    expect(html).toContain("Online request unavailable");
    expect(html).toContain('href="/contact"');
  });
});

describe("BookingFlow", () => {
  it("shows no request step before a quote", () => {
    const html = render(
      createElement(BookingFlow, {
        search: {},
        mapsBrowserKey: "unit-test-browser-placeholder",
        serviceArea: PROVISIONAL_SERVICE_AREA,
        stripePublishableKey: KEY,
      }),
    );
    expect(html).toContain("Voir le prix");
    expect(html).not.toContain("Votre demande");
    expect(loadStripe).not.toHaveBeenCalled();
  });
});
