import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { PageSection, SitePage } from "@/components/site/site-page";
import { textLinkClasses } from "@/components/ui/text-link";
import { localeFromParams } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/i18n/page-metadata";

// Needs already named on the home page; no commercial term (account, invoicing, rates) is
// stated while the B2B offer and its contact channel are open (DEC-20).
const NEEDS = ["team", "guests", "events"] as const;

export const generateMetadata = pageMetadata("business", "/entreprises");

export default async function BusinessPage({ params }: PageProps<"/[locale]/entreprises">) {
  setRequestLocale(await localeFromParams(params));
  return <Business />;
}

function Business() {
  const t = useTranslations("Pages.business");

  return (
    <SitePage title={t("title")} lead={t("lead")}>
      <PageSection id="needs" title={t("needsTitle")}>
        <ul className="flex max-w-[60ch] flex-col border-t border-hairline">
          {NEEDS.map((need) => (
            <li key={need} className="border-b border-hairline py-4">
              {t(`needs.${need}`)}
            </li>
          ))}
        </ul>
      </PageSection>

      <ProvisionalNotice decisions="DEC-20">
        <p>{t("pending")}</p>
      </ProvisionalNotice>

      <p>
        {t("contactPrompt")}{" "}
        <Link href="/contact" className={textLinkClasses}>
          {t("contactLink")}
        </Link>
      </p>
    </SitePage>
  );
}
