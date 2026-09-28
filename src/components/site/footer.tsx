import { useTranslations } from "next-intl";

import { Container } from "@/components/ui/container";
import { Link } from "@/i18n/navigation";
import { SITE_IDENTITY_DECISIONS, SITE_IDENTITY_FIELDS, siteIdentity } from "@/lib/site-identity";

import { LEGAL_NAV, SITE_NAV } from "./nav";

const footerLinkClasses =
  "text-paper underline decoration-on-ink-muted decoration-1 underline-offset-[5px] " +
  "transition-[text-decoration-color] duration-200 ease-settle hover:decoration-paper";

/** Public site footer: the page's single ink band (DESIGN.md, Single Binding Rule). */
export function SiteFooter() {
  const t = useTranslations("Site");
  const provisional = t("footer.provisional", { decisions: SITE_IDENTITY_DECISIONS });

  return (
    <footer className="bg-ink text-paper">
      <Container className="grid gap-12 pt-16 pb-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <p className="font-display-optical text-[1.75rem] leading-none">Avelys</p>
          <p className="max-w-[32ch] text-on-ink-muted">{t("footer.tagline")}</p>
        </div>

        <nav aria-labelledby="footer-nav-title" className="flex flex-col gap-4">
          <h2 id="footer-nav-title" className="small-caps-label text-on-ink-muted">
            {t("footer.navTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {SITE_NAV.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className={footerLinkClasses}>
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/reservation" className={footerLinkClasses}>
                {t("book")}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-legal-title" className="flex flex-col gap-4">
          <h2 id="footer-legal-title" className="small-caps-label text-on-ink-muted">
            {t("footer.legalTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {LEGAL_NAV.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className={footerLinkClasses}>
                  {t(`footer.legal.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="footer-identity-title" className="flex flex-col gap-4">
          <h2 id="footer-identity-title" className="small-caps-label text-on-ink-muted">
            {t("footer.identityTitle")}
          </h2>
          <dl className="flex flex-col gap-3 text-sm">
            {SITE_IDENTITY_FIELDS.map((field) => {
              const value = siteIdentity[field];
              return (
                <div key={field} className="flex flex-col">
                  <dt className="text-on-ink-muted">{t(`footer.identity.${field}`)}</dt>
                  <dd className={value ? undefined : "italic"}>{value ?? provisional}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      </Container>
    </footer>
  );
}
