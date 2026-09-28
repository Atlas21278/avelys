import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { IdentityList } from "@/components/site/identity-list";
import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { PageSection, SitePage } from "@/components/site/site-page";
import { localeFromParams } from "@/i18n/locale";
import { pageMetadata } from "@/i18n/page-metadata";
import { siteIdentity } from "@/lib/site-identity";

// Direct channels come from site-identity (DEC-20). No contact form: sending email arrives
// with EPIC-13.
const CHANNELS = ["phone", "email"] as const;

export const generateMetadata = pageMetadata("contact", "/contact");

export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  setRequestLocale(await localeFromParams(params));
  return <Contact />;
}

function Contact() {
  const t = useTranslations("Pages.contact");
  const pending = CHANNELS.some((channel) => siteIdentity[channel] === null);

  return (
    <SitePage title={t("title")} lead={t("lead")}>
      <PageSection id="channels" title={t("channelsTitle")}>
        <IdentityList fields={CHANNELS} />
        {pending ? (
          <ProvisionalNotice decisions="DEC-20">
            <p>{t("pending")}</p>
          </ProvisionalNotice>
        ) : null}
      </PageSection>
    </SitePage>
  );
}
