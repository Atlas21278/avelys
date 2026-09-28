import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { SitePage } from "@/components/site/site-page";
import { localeFromParams } from "@/i18n/locale";
import { pageMetadata } from "@/i18n/page-metadata";

export const generateMetadata = pageMetadata("cookies", "/cookies");

/**
 * Provisional cookie policy. The only statement is a current fact: the public site sets no
 * analytics or advertising cookie, and none will be set without consent (docs/product/seo.md).
 * The consent banner and the full policy come with EPIC-14; cookie lifetimes depend on the
 * retention rules (DEC-11).
 */
export default async function CookiesPage({ params }: PageProps<"/[locale]/cookies">) {
  setRequestLocale(await localeFromParams(params));
  return <Cookies />;
}

function Cookies() {
  const t = useTranslations("Pages.cookies");

  return (
    <SitePage title={t("title")}>
      <ProvisionalNotice decisions="DEC-11">
        <p>{t("pending")}</p>
      </ProvisionalNotice>
      <p className="max-w-[65ch]">{t("current")}</p>
    </SitePage>
  );
}
