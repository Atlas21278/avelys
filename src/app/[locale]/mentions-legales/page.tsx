import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { IdentityList } from "@/components/site/identity-list";
import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { PageSection, SitePage } from "@/components/site/site-page";
import { localeFromParams } from "@/i18n/locale";
import { pageMetadata } from "@/i18n/page-metadata";
import { SITE_IDENTITY_DECISIONS, SITE_IDENTITY_FIELDS } from "@/lib/site-identity";

export const generateMetadata = pageMetadata("legalNotice", "/mentions-legales");

/** Provisional legal notice (DEC-08): only the configurable identity fields, no invented text. */
export default async function LegalNoticePage({ params }: PageProps<"/[locale]/mentions-legales">) {
  setRequestLocale(await localeFromParams(params));
  return <LegalNotice />;
}

function LegalNotice() {
  const t = useTranslations("Pages.legalNotice");

  return (
    <SitePage title={t("title")}>
      <ProvisionalNotice decisions={SITE_IDENTITY_DECISIONS}>
        <p>{t("pending")}</p>
      </ProvisionalNotice>
      <PageSection id="publisher" title={t("publisherTitle")}>
        <IdentityList fields={SITE_IDENTITY_FIELDS} />
      </PageSection>
    </SitePage>
  );
}
