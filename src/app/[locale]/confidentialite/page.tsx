import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { SitePage } from "@/components/site/site-page";
import { textLinkClasses } from "@/components/ui/text-link";
import { localeFromParams } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/i18n/page-metadata";

export const generateMetadata = pageMetadata("privacy", "/confidentialite");

/** Provisional privacy policy: the text depends on the GDPR retention rules (DEC-11). */
export default async function PrivacyPage({ params }: PageProps<"/[locale]/confidentialite">) {
  setRequestLocale(await localeFromParams(params));
  return <Privacy />;
}

function Privacy() {
  const t = useTranslations("Pages.privacy");

  return (
    <SitePage title={t("title")}>
      <ProvisionalNotice decisions="DEC-11">
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
