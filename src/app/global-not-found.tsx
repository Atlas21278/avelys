import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/ui/container";
import { textLinkClasses } from "@/components/ui/text-link";
import messages from "@/i18n/messages/fr.json";
import { routing } from "@/i18n/routing";

import { bodoni, schibsted } from "./fonts";
import "./globals.css";

// 404 for URLs matching no route at all (the app has one root layout per area, so there is
// no single layout to compose it from). Localized URLs get `[locale]/not-found.tsx` instead.
const t = messages.NotFound;

export const metadata: Metadata = { title: t.metaTitle };

export default function GlobalNotFound() {
  return (
    <html lang={routing.defaultLocale} className={`${bodoni.variable} ${schibsted.variable}`}>
      <body>
        <main>
          <Container className="flex flex-col gap-4 pt-14 pb-24">
            <h1 className="font-display-optical text-display-sm">{t.title}</h1>
            <p className="text-graphite">{t.description}</p>
            <p>
              <Link href="/" className={textLinkClasses}>
                {t.home}
              </Link>
            </p>
          </Container>
        </main>
      </body>
    </html>
  );
}
