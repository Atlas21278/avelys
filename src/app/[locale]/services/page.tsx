import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { PageSection, SitePage } from "@/components/site/site-page";
import { buttonClasses } from "@/components/ui/button";
import { localeFromParams } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/i18n/page-metadata";

import { SERVICES } from "../_components/services";

export const generateMetadata = pageMetadata("services", "/services");

export default async function ServicesPage({ params }: PageProps<"/[locale]/services">) {
  setRequestLocale(await localeFromParams(params));
  return <Services />;
}

function Services() {
  const t = useTranslations("Pages.services");
  const tItems = useTranslations("Home.services.items");

  return (
    <SitePage title={t("title")} lead={t("lead")}>
      <ul className="grid border-t border-hairline sm:grid-cols-2">
        {SERVICES.map((service) => (
          <li
            key={service}
            className="flex flex-col gap-1.5 border-b border-hairline py-6 sm:odd:pr-8 sm:even:pl-8"
          >
            <h2 className="font-display-figure text-xl">{tItems(`${service}.title`)}</h2>
            <p className="max-w-[52ch] text-graphite">{tItems(`${service}.text`)}</p>
          </li>
        ))}
      </ul>

      <PageSection id="price" title={t("priceTitle")}>
        <p className="max-w-[60ch]">{t("priceText")}</p>
        <p>
          <Link href="/" className={buttonClasses("primary", "lg")}>
            {t("cta")}
          </Link>
        </p>
      </PageSection>
    </SitePage>
  );
}
