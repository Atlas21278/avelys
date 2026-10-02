import { defineRouting } from "next-intl/routing";

/**
 * Locale routing (ADR-0004, DEC-21): French is the default and has no prefix, English lives
 * under `/en` with translated slugs. Keys are the internal pathnames, i.e. the folder names
 * under `src/app/[locale]`; each page is created by its own ticket.
 */
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "as-needed",
  // The URL alone decides the language: `/` is always French, whatever the browser sends.
  // Visitors switch with the language selector, so no locale cookie is needed either.
  localeDetection: false,
  localeCookie: false,
  // hreflang is emitted once, by the Metadata API (`alternates`), not as `Link` headers.
  alternateLinks: false,
  pathnames: {
    "/": "/",
    "/services": "/services",
    "/entreprises": { fr: "/entreprises", en: "/business" },
    "/flotte": { fr: "/flotte", en: "/fleet" },
    "/a-propos": { fr: "/a-propos", en: "/about" },
    "/contact": "/contact",
    "/reservation": { fr: "/reservation", en: "/booking" },
    "/compte": { fr: "/compte", en: "/account" },
    // Legal pages (VTC-018): provisional content until DEC-08, DEC-09, DEC-10 and DEC-11 close.
    "/mentions-legales": { fr: "/mentions-legales", en: "/legal-notice" },
    "/confidentialite": { fr: "/confidentialite", en: "/privacy" },
    "/cookies": "/cookies",
    "/cgv": { fr: "/cgv", en: "/terms" },
    // SCA regularisation page reached by a signed link (VTC-042): never linked from the site,
    // never in a sitemap, `noindex`.
    "/paiement/[token]": { fr: "/paiement/[token]", en: "/payment/[token]" },
  },
});

export type Locale = (typeof routing.locales)[number];
export type AppPathname = keyof typeof routing.pathnames;
/** Pathnames without a dynamic segment: the indexable pages, with canonical and hreflang. */
export type StaticPathname = Exclude<AppPathname, `${string}[${string}]${string}`>;
