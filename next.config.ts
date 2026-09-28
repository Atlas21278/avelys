import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Several root layouts (`[locale]` for the public site, `design`) and no shared one:
    // `app/global-not-found.tsx` renders the 404 for URLs that match no route.
    globalNotFound: true,
  },
};

// Wires src/i18n/request.ts (locale and messages per request) into the build.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
