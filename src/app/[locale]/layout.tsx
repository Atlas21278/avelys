import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { localeFromParams } from "@/i18n/locale";
import { serverEnv } from "@/lib/env/server";

import { bodoni, schibsted } from "../fonts";
import "../globals.css";

// Absolute canonical and hreflang URLs are resolved against APP_URL at request time, so one
// image serves every environment (pages are rendered on demand, not at build time).
export function generateMetadata(): Metadata {
  return { metadataBase: new URL(serverEnv().APP_URL) };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await localeFromParams(params);
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${bodoni.variable} ${schibsted.variable}`}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
