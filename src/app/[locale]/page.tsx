import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Container } from "@/components/ui/container";
import { localeAlternates } from "@/i18n/alternates";
import { localeFromParams } from "@/i18n/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: localeAlternates("/", locale),
  };
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  const locale = await localeFromParams(params);
  setRequestLocale(locale);
  const t = await getTranslations("Home");

  return (
    <>
      <header>
        <Container className="flex justify-end py-4">
          <LocaleSwitcher />
        </Container>
      </header>
      <main>
        <Container className="flex flex-col gap-3 pt-14 pb-24">
          <h1 className="font-display-optical text-display">{t("title")}</h1>
          <p className="text-graphite">{t("tagline")}</p>
        </Container>
      </main>
    </>
  );
}
