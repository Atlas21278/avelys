import { useTranslations } from "next-intl";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { buttonClasses } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Link } from "@/i18n/navigation";

import { MobileMenu } from "./mobile-menu";
import { SITE_NAV } from "./nav";

export const navLinkClasses =
  "text-ink underline-offset-[5px] decoration-1 transition-[text-decoration-color] duration-200 ease-settle " +
  "hover:underline hover:decoration-rule";

/** Public site header: wordmark, main navigation, language selector and booking action. */
export function SiteHeader() {
  const t = useTranslations("Site");

  return (
    <header className="relative border-b border-hairline">
      <Container className="flex min-h-16 items-center justify-between gap-6">
        <Link
          href="/"
          aria-label={t("homeLabel")}
          className="font-display-optical text-[1.75rem] leading-none tracking-[-0.01em]"
        >
          Avelys
        </Link>

        <nav aria-label={t("navLabel")} className="hidden lg:block">
          <ul className="flex gap-7">
            {SITE_NAV.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className={navLinkClasses}>
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-7 lg:flex">
          <LocaleSwitcher />
          <Link href="/reservation" className={buttonClasses("primary", "md")}>
            {t("book")}
          </Link>
        </div>

        <MobileMenu className="lg:hidden" />
      </Container>
    </header>
  );
}
