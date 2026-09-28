import type { Metadata } from "next";

import { getPathname } from "./navigation";
import { routing, type AppPathname, type Locale } from "./routing";

type Alternates = NonNullable<Metadata["alternates"]>;

/**
 * Canonical URL and reciprocal hreflang links for one page, relative to `metadataBase`
 * (set from APP_URL in the locale layout). `x-default` points to the French page.
 */
export function localeAlternates(href: AppPathname, locale: Locale): Alternates {
  const languages: Record<string, string> = {};
  for (const alternate of routing.locales) {
    languages[alternate] = getPathname({ href, locale: alternate });
  }
  languages["x-default"] = getPathname({ href, locale: routing.defaultLocale });

  return { canonical: getPathname({ href, locale }), languages };
}
