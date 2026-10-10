"use client";

import NextLink from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { getPathname, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cx } from "@/lib/cx";

/**
 * Language selector: links to the same page in each locale (translated slug included).
 * Plain links, so it works without JavaScript and the choice stays in the URL. The href is
 * computed with getPathname so French links point to `/…`, not to `/fr/…` (a redirect hop).
 */
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale();
  const pathname = usePathname();
  const params = useParams<{ token?: string }>();
  // Typing only: the routing table now holds a dynamic pathname (`/paiement/[token]`, VTC-042),
  // whose page renders its own language link and never this selector. Should it ever be rendered
  // there without its parameter, the selector is omitted rather than pointing to a broken URL.
  let href: Parameters<typeof getPathname>[0]["href"];
  if (pathname === "/paiement/[token]") {
    if (!params.token) return null;
    href = { pathname, params: { token: params.token } };
  } else {
    href = pathname;
  }

  return (
    <nav aria-label={t("label")}>
      <ul className="flex gap-4 text-caption">
        {routing.locales.map((locale) => {
          const active = locale === current;
          return (
            <li key={locale}>
              <NextLink
                href={getPathname({ href, locale })}
                hrefLang={locale}
                lang={locale}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "underline-offset-[5px] transition-[text-decoration-color] duration-200 ease-settle",
                  active
                    ? "text-ink underline decoration-champagne decoration-1"
                    : "text-graphite hover:text-ink hover:underline hover:decoration-rule",
                )}
              >
                {t(locale)}
              </NextLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
