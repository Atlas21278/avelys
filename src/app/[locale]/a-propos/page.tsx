import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { SitePage } from "@/components/site/site-page";
import { localeFromParams } from "@/i18n/locale";
import { pageMetadata } from "@/i18n/page-metadata";

// Decided facts only (Master Spec §1, BR-01, BR-02): no figure, review or testimonial.
const ITEMS = ["founders", "validation", "languages"] as const;

export const generateMetadata = pageMetadata("about", "/a-propos");

export default async function AboutPage({ params }: PageProps<"/[locale]/a-propos">) {
  setRequestLocale(await localeFromParams(params));
  return <About />;
}

function About() {
  const t = useTranslations("Pages.about");

  return (
    <SitePage title={t("title")} lead={t("lead")}>
      <ul className="grid gap-x-10 gap-y-8 md:grid-cols-3">
        {ITEMS.map((item) => (
          <li key={item} className="flex flex-col gap-2 border-t border-ink pt-5">
            <h2 className="font-display-figure text-xl">{t(`items.${item}.title`)}</h2>
            <p className="max-w-[52ch] text-graphite">{t(`items.${item}.text`)}</p>
          </li>
        ))}
      </ul>
    </SitePage>
  );
}
