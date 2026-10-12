import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // SCA regularisation page (VTC-042): its URL holds a signed token. Never sent as a referrer,
  // never stored by a cache, never indexed (docs/architecture/security.md).
  async headers() {
    const linkHeaders = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    // Canonical paths, plus the untranslated or prefixed spellings next-intl redirects.
    return [
      "/paiement/:token",
      "/fr/paiement/:token",
      "/en/payment/:token",
      "/en/paiement/:token",
      "/fr/payment/:token",
    ].map((source) => ({
      source,
      headers: linkHeaders,
    }));
  },
  experimental: {
    // Several root layouts (`[locale]` for the public site, `design`) and no shared one:
    // `app/global-not-found.tsx` renders the 404 for URLs that match no route.
    globalNotFound: true,
  },
};

// Wires src/i18n/request.ts (locale and messages per request) into the build.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
