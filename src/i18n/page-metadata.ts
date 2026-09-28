import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { localeAlternates } from "./alternates";
import { localeFromParams } from "./locale";
import type messages from "./messages/fr.json";
import type { AppPathname } from "./routing";

/** A content page with its own `Pages.<key>` namespace (`metaTitle`, `metaDescription`). */
export type PageKey = keyof (typeof messages)["Pages"];

/**
 * `generateMetadata` for a public content page: translated title and description, canonical
 * URL and reciprocal hreflang (FR, EN, `x-default`) for its internal pathname.
 */
export function pageMetadata(key: PageKey, href: AppPathname) {
  return async function generateMetadata({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }): Promise<Metadata> {
    const locale = await localeFromParams(params);
    const t = await getTranslations({ locale, namespace: "Pages" });

    return {
      title: t(`${key}.metaTitle`),
      description: t(`${key}.metaDescription`),
      alternates: localeAlternates(href, locale),
    };
  };
}
