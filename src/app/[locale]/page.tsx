import type { Metadata } from "next";
import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { Container } from "@/components/ui/container";
import { Signet } from "@/components/ui/signet";
import { textLinkClasses } from "@/components/ui/text-link";
import { localeAlternates } from "@/i18n/alternates";
import { localeFromParams } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { bookingSearchHref } from "@/lib/booking-search";

import { SearchForm } from "./_components/search-form";

// V1 services (docs/product/vision.md, "Prestations V1"). No price, duration or capacity is shown.
const SERVICES = [
  "airports",
  "door",
  "stations",
  "excursions",
  "hourly",
  "longDistance",
  "business",
  "events",
] as const;

// Confirmed differentiators (PRODUCT.md, Positioning) and decided booking facts.
const ADVANTAGES = ["founders", "fixedPrice", "electric", "simple"] as const;

// Popular destinations (Master Spec §4.1): names only, never a price.
const DESTINATIONS = ["cdg", "orly", "disneyland", "versailles"] as const;

// Only decided facts (ticket VTC-014): no answer on price, cancellation, refund, waiting or no-show
// while DEC-03, DEC-05 and DEC-06 are open.
const FAQ = ["account", "languages", "validation", "payment"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: localeAlternates("/", locale),
  };
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  const locale = await localeFromParams(params);
  setRequestLocale(locale);

  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Container className="flex flex-col gap-24 pt-20 pb-24 sm:gap-28">
          <Services />
          <Advantages />
          <Fleet />
          <Destinations />
          <Business />
          <Faq />
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

function Hero() {
  const t = useTranslations("Home.hero");
  const tSearch = useTranslations("Home.search");

  return (
    <section aria-labelledby="hero-title" className="border-b border-hairline">
      <Container className="grid items-start gap-8 pt-6 pb-14 sm:pt-10 md:grid-cols-[1fr_minmax(0,28rem)] md:gap-12 md:pt-16 md:pb-20 lg:gap-20">
        <div className="flex flex-col gap-4 md:gap-6 md:pt-6">
          <h1 id="hero-title" className="font-display-optical text-display">
            {t("title")}
          </h1>
          <p className="max-w-[46ch] sm:text-lg">{t("lead")}</p>
        </div>

        <article className="relative -mx-4 bg-paper-deep px-4 pt-6 pb-6 shadow-page sm:mx-0 sm:px-6">
          <Signet className="absolute -top-2 right-6" />
          <h2 id="search-title" className="mb-5 font-display-figure text-xl">
            {tSearch("title")}
          </h2>
          <SearchForm titleId="search-title" />
        </article>
      </Container>
    </section>
  );
}

function Services() {
  const t = useTranslations("Home.services");

  return (
    <HomeSection id="services" title={t("title")} intro={t("intro")}>
      <ul className="grid border-t border-hairline sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.map((service) => (
          <li key={service} className="flex flex-col gap-1.5 border-b border-hairline py-5 sm:pr-6">
            <h3 className="font-display-figure text-xl">{t(`items.${service}.title`)}</h3>
            <p className="text-graphite">{t(`items.${service}.text`)}</p>
          </li>
        ))}
      </ul>
      <p>
        <Link href="/services" className={textLinkClasses}>
          {t("more")}
        </Link>
      </p>
    </HomeSection>
  );
}

function Advantages() {
  const t = useTranslations("Home.advantages");

  return (
    <HomeSection id="advantages" title={t("title")}>
      <ol className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        {ADVANTAGES.map((advantage, index) => (
          <li key={advantage} className="flex gap-5">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-ink text-[0.8125rem] font-semibold"
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-1.5">
              <h3 className="font-display-figure text-xl">{t(`items.${advantage}.title`)}</h3>
              <p className="max-w-[52ch] text-graphite">{t(`items.${advantage}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </HomeSection>
  );
}

function Fleet() {
  const t = useTranslations("Home.fleet");

  return (
    <HomeSection id="fleet" title={t("title")}>
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
        {/* Provisional image slot: no photograph of the cars exists yet (PRODUCT.md, Evidence). */}
        <figure className="flex aspect-[3/2] items-center justify-center border border-dashed border-rule p-6 text-center">
          <figcaption className="text-sm text-graphite">{t("photoPlaceholder")}</figcaption>
        </figure>
        <div className="flex flex-col gap-4">
          <h3 className="font-display-figure text-2xl">{t("model")}</h3>
          <p className="max-w-[52ch]">{t("text")}</p>
          <p className="text-sm text-graphite">{t("detailsPending")}</p>
          <p>
            <Link href="/flotte" className={textLinkClasses}>
              {t("more")}
            </Link>
          </p>
        </div>
      </div>
    </HomeSection>
  );
}

function Destinations() {
  const t = useTranslations("Home.destinations");
  const locale = useLocale();

  return (
    <HomeSection id="destinations" title={t("title")} intro={t("intro")}>
      <ul className="grid border-t border-hairline sm:grid-cols-2">
        {DESTINATIONS.map((destination) => {
          const name = t(`items.${destination}.name`);
          return (
            <li
              key={destination}
              className="flex flex-col gap-3 border-b border-hairline py-5 sm:odd:pr-8 sm:even:pl-8"
            >
              <div className="flex flex-col gap-0.5">
                <h3 className="font-display-figure text-xl">{name}</h3>
                <p className="text-sm text-graphite">{t(`items.${destination}.detail`)}</p>
              </div>
              <p>
                <NextLink
                  href={bookingSearchHref({ dropoff: name }, locale)}
                  className={textLinkClasses}
                >
                  {t("cta")}
                  <span className="sr-only"> {t("ctaTarget", { name })}</span>
                </NextLink>
              </p>
            </li>
          );
        })}
      </ul>
    </HomeSection>
  );
}

function Business() {
  const t = useTranslations("Home.business");

  return (
    <HomeSection id="business" title={t("title")}>
      <div className="flex flex-col gap-5 border-l border-ink pl-6">
        <p className="max-w-[60ch] text-lg">{t("text")}</p>
        <p>
          <Link href="/entreprises" className={textLinkClasses}>
            {t("cta")}
          </Link>
        </p>
      </div>
    </HomeSection>
  );
}

function Faq() {
  const t = useTranslations("Home.faq");

  return (
    <HomeSection id="faq" title={t("title")}>
      <div className="border-t border-hairline">
        {FAQ.map((question) => (
          <details key={question} className="group border-b border-hairline">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-4 font-semibold [&::-webkit-details-marker]:hidden">
              {t(`items.${question}.question`)}
              <svg
                aria-hidden="true"
                viewBox="0 0 12 8"
                className="h-2 w-3 shrink-0 transition-transform duration-200 ease-settle group-open:rotate-180"
                fill="none"
              >
                <path d="M1 1.5 6 6.5l5-5" stroke="currentColor" strokeWidth="1.25" />
              </svg>
            </summary>
            <p className="max-w-[65ch] pb-5 text-graphite">{t(`items.${question}.answer`)}</p>
          </details>
        ))}
      </div>
      <p>
        {t("contactPrompt")}{" "}
        <Link href="/contact" className={textLinkClasses}>
          {t("contactLink")}
        </Link>
      </p>
    </HomeSection>
  );
}

function HomeSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h2 id={`${id}-title`} className="font-display-optical text-display-sm">
          {title}
        </h2>
        {intro ? <p className="max-w-[60ch] text-graphite">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}
