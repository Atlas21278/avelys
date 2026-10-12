import { useTranslations } from "next-intl";

import { Container } from "@/components/ui/container";
import { textLinkClasses } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";

/**
 * The single answer to every refused regularisation link (VTC-042): altered token, another
 * attempt, Payment no longer waiting, booking not accepted, pickup passed, secret missing… Same
 * text, same 404 status, whatever the reason: the page is no oracle.
 */
export default function RegularizationLinkNotFound() {
  const t = useTranslations("Regularization.invalid");

  return (
    <main>
      <title>{t("metaTitle")}</title>
      <meta name="referrer" content="no-referrer" />
      <Container className="flex flex-col gap-4 pt-14 pb-24">
        <p className="font-display-optical text-[1.75rem] leading-none">Avelys</p>
        <h1 className="font-display-optical text-display-sm">{t("title")}</h1>
        <p className="max-w-[60ch] text-graphite">{t("description")}</p>
        <p>
          <Link href="/contact" className={textLinkClasses}>
            {t("contact")}
          </Link>
        </p>
      </Container>
    </main>
  );
}
