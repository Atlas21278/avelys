import { createTranslator } from "next-intl";

import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";
import type { Locale } from "@/i18n/routing";

/**
 * Translator for emails (VTC-043). Emails are rendered outside any request, so they read the
 * same message catalogues as the site directly instead of the request configuration.
 */
const CATALOGUES = { fr, en } as const;

export function emailTranslator(locale: Locale) {
  return createTranslator({ locale, messages: CATALOGUES[locale] });
}
