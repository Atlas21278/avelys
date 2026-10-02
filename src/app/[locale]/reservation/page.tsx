import { useFormatter, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { BookingFlow } from "@/components/booking/booking-flow";
import { QuoteUnavailable } from "@/components/booking/quote-step";
import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { PageSection, SitePage } from "@/components/site/site-page";
import { textLinkClasses } from "@/components/ui/text-link";
import { localeFromParams } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/i18n/page-metadata";
import { readBookingSearch, type BookingSearch } from "@/lib/booking-search";
import { publicQuoteSettings, type PublicQuoteSettings } from "@/server/public-booking";

export const generateMetadata = pageMetadata("booking", "/reservation");

/**
 * Booking page. Behind `PUBLIC_BOOKING_ENABLED` (VTC-045) it offers the booking flow: the server
 * quote (VTC-046), then the request with the card saved through Stripe (VTC-047); switched off, it stays the placeholder that reads back the home
 * page search (VTC-014) and never shows a price. Invalid parameters are ignored, never a 500.
 * The settings are read per request (the page is dynamic: it reads its search parameters).
 */
export default async function BookingPage({
  params,
  searchParams,
}: PageProps<"/[locale]/reservation">) {
  setRequestLocale(await localeFromParams(params));
  const search = readBookingSearch(await searchParams);
  const settings = publicQuoteSettings();
  if (!settings.enabled) return <Booking search={search} />;
  return <OnlineBooking search={search} settings={settings} />;
}

function OnlineBooking({
  search,
  settings,
}: {
  search: BookingSearch;
  settings: Extract<PublicQuoteSettings, { enabled: true }>;
}) {
  const t = useTranslations("Pages.booking");

  return (
    <SitePage title={t("title")} lead={t("quote.lead")}>
      {settings.mapsBrowserKey ? (
        <BookingFlow
          search={search}
          mapsBrowserKey={settings.mapsBrowserKey}
          serviceArea={settings.serviceArea}
          stripePublishableKey={settings.stripePublishableKey}
        />
      ) : (
        <QuoteUnavailable />
      )}
    </SitePage>
  );
}

function Booking({ search }: { search: BookingSearch }) {
  const t = useTranslations("Pages.booking");

  return (
    <SitePage title={t("title")} lead={t("lead")}>
      <ProvisionalNotice>
        <p>{t("pending")}</p>
      </ProvisionalNotice>

      <PageSection id="search" title={t("searchTitle")}>
        <SearchSummary search={search} />
        <p>
          <Link href="/" className={textLinkClasses}>
            {t("edit")}
          </Link>
        </p>
      </PageSection>

      <p>
        {t("contactPrompt")}{" "}
        <Link href="/contact" className={textLinkClasses}>
          {t("contactLink")}
        </Link>
      </p>
    </SitePage>
  );
}

function SearchSummary({ search }: { search: BookingSearch }) {
  const t = useTranslations("Pages.booking");
  const format = useFormatter();

  const rows: { key: keyof BookingSearch; value: string }[] = [];
  if (search.pickup) rows.push({ key: "pickup", value: search.pickup });
  if (search.dropoff) rows.push({ key: "dropoff", value: search.dropoff });
  if (search.date) {
    // A calendar date with no time: formatted at noon UTC so no time zone can shift the day.
    const day = new Date(`${search.date}T12:00:00Z`);
    rows.push({
      key: "date",
      value: format.dateTime(day, { dateStyle: "full", timeZone: "UTC" }),
    });
  }
  if (search.time) rows.push({ key: "time", value: search.time });
  if (search.passengers !== undefined) {
    rows.push({ key: "passengers", value: t("passengersValue", { count: search.passengers }) });
  }
  if (search.luggage !== undefined) {
    rows.push({ key: "luggage", value: t("luggageValue", { count: search.luggage }) });
  }

  if (rows.length === 0) return <p className="text-graphite">{t("empty")}</p>;

  return (
    <dl className="grid max-w-[65ch] border-t border-hairline">
      {rows.map(({ key, value }) => (
        <div
          key={key}
          className="grid gap-1 border-b border-hairline py-3 sm:grid-cols-[14rem_1fr] sm:gap-6"
        >
          <dt className="text-graphite">{t(`fields.${key}`)}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
