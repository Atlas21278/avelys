import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { SitePage } from "@/components/site/site-page";
import { localeFromParams } from "@/i18n/locale";
import { pageMetadata } from "@/i18n/page-metadata";

export const generateMetadata = pageMetadata("fleet", "/flotte");

export default async function FleetPage({ params }: PageProps<"/[locale]/flotte">) {
  setRequestLocale(await localeFromParams(params));
  return <Fleet />;
}

function Fleet() {
  const t = useTranslations("Pages.fleet");

  return (
    <SitePage title={t("title")} lead={t("lead")}>
      <div className="grid items-start gap-8 md:grid-cols-2 md:gap-12">
        {/* Provisional image slot: no photograph of the cars exists yet (PRODUCT.md, Evidence). */}
        <figure
          data-provisional=""
          className="flex aspect-[3/2] items-center justify-center border border-dashed border-rule p-6 text-center"
        >
          <figcaption className="text-sm text-graphite">{t("photoPlaceholder")}</figcaption>
        </figure>
        <div className="flex flex-col gap-5">
          <h2 className="font-display-figure text-2xl">{t("model")}</h2>
          <p className="max-w-[52ch]">{t("text")}</p>
          {/* Trim and commercial capacity are not decided (DEC-02, BR-24): no figure shown. */}
          <ProvisionalNotice decisions="DEC-02">
            <p>{t("pending")}</p>
          </ProvisionalNotice>
        </div>
      </div>
    </SitePage>
  );
}
