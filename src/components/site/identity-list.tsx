import { useTranslations } from "next-intl";

import { SITE_IDENTITY_DECISIONS, siteIdentity, type SiteIdentityField } from "@/lib/site-identity";

/**
 * Company identity and contact channels on a light page (legal notice, contact). A value that
 * is not decided yet (`null`) shows the provisional placeholder with its open decisions.
 */
export function IdentityList({ fields }: { fields: readonly SiteIdentityField[] }) {
  const t = useTranslations("Site.footer");
  const provisional = t("provisional", { decisions: SITE_IDENTITY_DECISIONS });

  return (
    <dl className="grid max-w-[65ch] border-t border-hairline">
      {fields.map((field) => {
        const value = siteIdentity[field];
        return (
          <div
            key={field}
            data-provisional={value ? undefined : SITE_IDENTITY_DECISIONS}
            className="grid gap-1 border-b border-hairline py-3 sm:grid-cols-[14rem_1fr] sm:gap-6"
          >
            <dt className="text-graphite">{t(`identity.${field}`)}</dt>
            <dd className={value ? undefined : "text-graphite italic"}>{value ?? provisional}</dd>
          </div>
        );
      })}
    </dl>
  );
}
