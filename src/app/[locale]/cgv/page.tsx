import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { PageSection, SitePage } from "@/components/site/site-page";
import { localeFromParams } from "@/i18n/locale";
import { pageMetadata } from "@/i18n/page-metadata";

// Consumer mediator (mandatory for B2C) not chosen yet.
const MEDIATOR_DECISION = "DEC-09";

export const generateMetadata = pageMetadata("terms", "/cgv");

/** Terms of sale awaiting legal validation (DEC-10): no contractual text is written here. */
export default async function TermsPage({ params }: PageProps<"/[locale]/cgv">) {
  setRequestLocale(await localeFromParams(params));
  return <Terms />;
}

function Terms() {
  const t = useTranslations("Pages.terms");

  return (
    <SitePage title={t("title")}>
      <ProvisionalNotice decisions="DEC-10">
        <p>{t("pending")}</p>
      </ProvisionalNotice>
      <PageSection id="mediator" title={t("mediatorTitle")}>
        <p data-provisional={MEDIATOR_DECISION} className="text-graphite italic">
          {t("mediatorPending", { decisions: MEDIATOR_DECISION })}
        </p>
      </PageSection>
    </SitePage>
  );
}
