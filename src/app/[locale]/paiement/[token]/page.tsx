import type { Metadata } from "next";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { RegularizationForm } from "@/components/payment/regularization-form";
import { SiteFooter } from "@/components/site/footer";
import { Container } from "@/components/ui/container";
import { textLinkClasses } from "@/components/ui/text-link";
import { localeFromParams } from "@/i18n/locale";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { PARIS_TIME_ZONE } from "@/lib/dates";
import { serverEnv } from "@/lib/env/server";
import {
  resolveRegularizationLink,
  type RegularizationSummary,
} from "@/server/payments/regularization-link";

/**
 * SCA regularisation page (VTC-042, DEC-27), reached only by the signed link of a Payment
 * `REQUIRES_ACTION`. Every refused link renders the same generic 404 (`not-found.tsx`), whatever
 * the reason. The page shows the reference, the pickup instant and the frozen TTC amount only,
 * and never writes a status: the webhooks confirm the booking (BR-41).
 *
 * Never indexed, never cached, no referrer (headers in next.config.ts, metadata below): the
 * URL holds the token. Rate limiting of this route belongs to INFRA-005.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/paiement/[token]">): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Regularization" });
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function RegularizationPage({
  params,
}: PageProps<"/[locale]/paiement/[token]">) {
  const locale = await localeFromParams(params);
  setRequestLocale(locale);
  const { token } = await params;

  const page = await resolveRegularizationLink(token);
  if (page.kind === "invalid") notFound();

  const t = await getTranslations({ locale, namespace: "Regularization" });
  const otherLocale: Locale = locale === "fr" ? "en" : "fr";

  const contact = (
    <p>
      <Link href="/contact" className={textLinkClasses}>
        {t("contactLink")}
      </Link>
    </p>
  );
  const settled = (
    <Outcome title={t("settledTitle")}>
      <p>{t("settledText")}</p>
    </Outcome>
  );
  const unavailable = (
    <Outcome title={t("unavailableTitle")}>
      <p>{t("unavailableText")}</p>
      {contact}
    </Outcome>
  );

  let body: ReactNode;
  switch (page.kind) {
    case "authenticate":
      body = (
        <section aria-labelledby="authenticate-title" className="flex flex-col gap-5">
          <h2 id="authenticate-title" className="font-display-figure text-2xl">
            {t("authenticateTitle")}
          </h2>
          <p className="max-w-[60ch]">{t("authenticateText")}</p>
          <RegularizationForm
            publishableKey={page.publishableKey}
            clientSecret={page.clientSecret}
            paymentMethodId={page.paymentMethodId}
            step={page.step}
            returnUrl={new URL(getPathname({ href: "/", locale }), serverEnv().APP_URL).toString()}
            settled={settled}
            unavailable={unavailable}
          />
        </section>
      );
      break;
    case "settled":
      body = settled;
      break;
    case "closed":
      body = (
        <Outcome title={t("closedTitle")}>
          <p>{t("closedText")}</p>
          {contact}
        </Outcome>
      );
      break;
    case "unavailable":
      body = unavailable;
      break;
  }

  return (
    <>
      <header className="border-b border-hairline">
        <Container className="flex min-h-16 items-center justify-between gap-6">
          <Link
            href="/"
            className="font-display-optical text-[1.75rem] leading-none tracking-[-0.01em]"
          >
            Avelys
          </Link>
          <NextLink
            href={getPathname({
              href: { pathname: "/paiement/[token]", params: { token } },
              locale: otherLocale,
            })}
            hrefLang={otherLocale}
            lang={otherLocale}
            className="text-caption text-graphite hover:text-ink hover:underline hover:decoration-rule"
          >
            {t("otherLanguage")}
          </NextLink>
        </Container>
      </header>
      <main>
        <Container className="flex flex-col gap-12 pt-10 pb-24 sm:pt-16">
          <div className="flex flex-col gap-4 border-b border-hairline pb-10">
            <h1 className="font-display-optical text-display-sm">{t("title")}</h1>
            <p className="max-w-[60ch] text-lg">{t("lead")}</p>
          </div>
          <Summary summary={page.summary} locale={locale} />
          {body}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

async function Summary({ summary, locale }: { summary: RegularizationSummary; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "Regularization" });
  const format = await getFormatter({ locale });

  return (
    <section aria-labelledby="summary-title" className="flex flex-col gap-5">
      <h2 id="summary-title" className="small-caps-label text-graphite">
        {t("summaryTitle")}
      </h2>
      <dl className="grid max-w-[65ch] border-t border-hairline">
        <Row label={t("reference")}>
          <span className="font-semibold tracking-[0.04em]">{summary.bookingRef}</span>
        </Row>
        <Row label={t("pickup")}>
          <time dateTime={summary.pickupAt.toISOString()}>
            {format.dateTime(summary.pickupAt, {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: PARIS_TIME_ZONE,
            })}
          </time>{" "}
          <span className="text-sm text-graphite">({t("pickupHint")})</span>
        </Row>
        <Row label={t("amount")}>
          <span className="font-display-figure text-2xl">
            {/* Display only: the amount is the Payment's frozen integer cents (BR-10). */}
            {format.number(summary.amountCents / 100, {
              style: "currency",
              currency: summary.currency,
            })}
          </span>
        </Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-hairline py-3 sm:grid-cols-[14rem_1fr] sm:gap-6">
      <dt className="text-graphite">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Outcome({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="outcome-title" className="flex max-w-[65ch] flex-col gap-4">
      <h2 id="outcome-title" className="font-display-figure text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}
