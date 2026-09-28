import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";

import { routing, type Locale } from "./routing";

/** Narrows the `[locale]` route param; an unsupported value is a 404, never a fallback. */
export async function localeFromParams(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return locale;
}
