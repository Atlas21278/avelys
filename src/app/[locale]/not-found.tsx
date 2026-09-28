import { useTranslations } from "next-intl";

import { Container } from "@/components/ui/container";
import { textLinkClasses } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";

export default function LocaleNotFound() {
  const t = useTranslations("NotFound");

  return (
    <main>
      <title>{t("metaTitle")}</title>
      <Container className="flex flex-col gap-4 pt-14 pb-24">
        <h1 className="font-display-optical text-display-sm">{t("title")}</h1>
        <p className="text-graphite">{t("description")}</p>
        <p>
          <Link href="/" className={textLinkClasses}>
            {t("home")}
          </Link>
        </p>
      </Container>
    </main>
  );
}
