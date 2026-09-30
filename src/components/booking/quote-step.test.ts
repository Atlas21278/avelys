import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PROVISIONAL_SERVICE_AREA } from "@/domain/geo/service-area";
import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";

// The navigation Link needs the Next.js router; a plain anchor is enough for markup checks.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));

const { QuoteStep, QuoteUnavailable } = await import("./quote-step");

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

const step = (search = {}) =>
  createElement(QuoteStep, {
    search,
    mapsBrowserKey: "unit-test-browser-placeholder",
    serviceArea: PROVISIONAL_SERVICE_AREA,
  });

describe("QuoteStep markup (Maps not loaded before interaction)", () => {
  it("renders both places as labelled ARIA comboboxes with a listbox popup", () => {
    const html = render(step());
    const comboboxes = html.match(/role="combobox"/g) ?? [];
    expect(comboboxes).toHaveLength(2);
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/role="listbox"/g)).toHaveLength(2);
    expect(html).toContain(">Départ<");
    expect(html).toContain(">Destination<");
  });

  it("shows an empty price slot, never a figure, before the server quote", () => {
    const html = render(step({ pickup: "Gare de Lyon", dropoff: "CDG T2" }));
    expect(html).toContain(fr.Pages.booking.quote.priceEmpty);
    expect(html).not.toMatch(/€/);
  });

  it("asks to confirm a place pre-filled from the home search", () => {
    const html = render(step({ pickup: "Gare de Lyon" }));
    expect(html).toContain('value="Gare de Lyon"');
    expect(html).toContain(fr.Pages.booking.quote.placeConfirm);
  });

  it("does not load the Maps script on render", () => {
    // Rendering on the server has no document: any script injection would throw here.
    expect(() => render(step())).not.toThrow();
  });

  it("is translated in English", () => {
    const html = render(step(), "en");
    expect(html).toContain(">Pick-up<");
    expect(html).toContain(en.Pages.booking.quote.submit);
  });
});

describe("QuoteUnavailable", () => {
  it("offers contact, never a price", () => {
    const html = render(createElement(QuoteUnavailable));
    expect(html).toContain(fr.Pages.booking.quote.unavailableTitle);
    expect(html).toContain('href="/contact"');
    expect(html).not.toMatch(/€/);
  });
});
