"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PriceSlot } from "@/components/ui/price-slot";
import { RouteLine } from "@/components/ui/route-line";
import { Signet } from "@/components/ui/signet";
import { textLinkClasses } from "@/components/ui/text-link";
import type { ServiceArea } from "@/domain/geo/service-area";
import { googlePlaceSuggestions } from "@/integrations/maps/browser";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { BookingSearch } from "@/lib/booking-search";
import {
  buildQuoteRequest,
  formatDistance,
  formatDuration,
  quoteFailureOf,
  readQuoteResponse,
  type QuoteDraftField,
  type QuoteFailure,
} from "@/lib/booking-quote";
import { formatMoney } from "@/lib/money";
import {
  draftOf,
  initialQuoteStepState,
  isSubmitting,
  quoteStepReducer,
  retainedQuote,
  type PlaceField,
  type PlainField,
  type QuoteStepState,
  type RetainedQuote,
} from "@/lib/quote-step-state";
import { siteIdentity } from "@/lib/site-identity";

import { PlaceAutocomplete } from "./place-autocomplete";

type QuoteStepProps = {
  search: BookingSearch;
  mapsBrowserKey: string;
  serviceArea: ServiceArea;
  /**
   * Called with the quote the visitor can book, or null as soon as any input changes (VTC-047
   * uses it to renew its SetupIntent and submissionId, see `quoteFingerprint`).
   */
  onQuoteChange?: (quote: RetainedQuote | null) => void;
};

/**
 * Step 1 of the public booking flow (VTC-046): places from the autocomplete, Paris wall-clock
 * time, passengers and luggage, then the quote computed by `POST /api/v1/quotes`. The browser
 * never computes nor sends an amount: the figure shown is the server's, formatted. Nothing is
 * persisted; the retained quote lives in this component's state.
 */
export function QuoteStep({ search, mapsBrowserKey, serviceArea, onQuoteChange }: QuoteStepProps) {
  const t = useTranslations("Pages.booking.quote");
  const locale = useLocale() as Locale;
  const [state, dispatch] = useReducer(quoteStepReducer, search, initialQuoteStepState);
  const [mapsUnavailable, setMapsUnavailable] = useState(false);
  const inFlight = useRef(false);
  const source = useMemo(
    () => googlePlaceSuggestions(mapsBrowserKey, { language: locale, serviceArea }),
    [mapsBrowserKey, locale, serviceArea],
  );

  const retained = retainedQuote(state);
  useEffect(() => {
    onQuoteChange?.(retained);
  }, [retained, onQuoteChange]);

  if (mapsUnavailable) return <QuoteUnavailable />;

  const submitting = isSubmitting(state);
  const issue = (field: QuoteDraftField) =>
    state.issues.includes(field) ? t(`issues.${field}`) : undefined;
  const setField = (field: PlainField) => (value: string) =>
    dispatch({ type: "field", field, value });
  const place = (field: PlaceField) => ({
    value: state[field],
    source,
    error: issue(field),
    onTextChange: (text: string) => dispatch({ type: "placeText", field, text }),
    onChoose: (chosen: { placeId: string; label: string }) =>
      dispatch({ type: "placeChosen", field, place: chosen }),
    onUnavailable: () => setMapsUnavailable(true),
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || submitting) return;
    const built = buildQuoteRequest(draftOf(state));
    if (!built.ok) {
      dispatch({ type: "invalid", issues: built.issues });
      return;
    }
    const revision = state.revision;
    inFlight.current = true;
    dispatch({ type: "submitted", revision });
    try {
      let response: Response;
      try {
        response = await fetch("/api/v1/quotes", {
          method: "POST",
          headers: { "content-type": "application/json", "accept-language": locale },
          body: JSON.stringify(built.request),
          cache: "no-store",
        });
      } catch {
        dispatch({ type: "failed", revision, failure: "network" });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const quote = response.ok ? readQuoteResponse(body) : null;
      if (quote) {
        dispatch({ type: "quoted", revision, request: built.request, quote });
      } else {
        const failure = response.ok ? "unavailable" : quoteFailureOf(response.status, body);
        dispatch({ type: "failed", revision, failure });
      }
    } finally {
      inFlight.current = false;
    }
  }

  const failure = state.outcome?.kind === "failure" ? state.outcome.failure : null;

  return (
    <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16">
      <form noValidate onSubmit={(event) => void onSubmit(event)} aria-labelledby="quote-title" className="flex flex-col gap-6">
        <h2 id="quote-title" className="font-display-figure text-2xl">
          {t("formTitle")}
        </h2>
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PlaceAutocomplete label={t("pickup")} {...place("pickup")} />
          </div>
          <div className="sm:col-span-2">
            <PlaceAutocomplete label={t("dropoff")} {...place("dropoff")} />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:col-span-2">
            <Field label={t("date")} error={issue("date")} required>
              <Input
                type="date"
                value={state.date}
                onChange={(event) => setField("date")(event.target.value)}
              />
            </Field>
            <Field label={t("time")} hint={t("timeHint")} error={issue("time")} required>
              <Input
                type="time"
                value={state.time}
                onChange={(event) => setField("time")(event.target.value)}
              />
            </Field>
            <Field label={t("passengers")} error={issue("passengers")} required>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={state.passengers}
                onChange={(event) => setField("passengers")(event.target.value)}
              />
            </Field>
            <Field label={t("luggage")} error={issue("luggage")} required>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={state.luggage}
                onChange={(event) => setField("luggage")(event.target.value)}
              />
            </Field>
          </div>
        </div>

        {state.issues.length > 0 ? (
          <p role="alert" className="text-sm text-rubric">
            {t("issuesSummary")}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" loading={submitting} className="w-full sm:w-auto sm:self-start">
            {t("submit")}
          </Button>
          <p className="text-sm text-graphite">{t("note")}</p>
        </div>

        <div role="alert" className="empty:hidden">
          {failure ? <QuoteFailureMessage failure={failure} /> : null}
        </div>
      </form>

      <Itinerary state={state} locale={locale} retained={retained} submitting={submitting} />
    </div>
  );
}

function Itinerary({
  state,
  locale,
  retained,
  submitting,
}: {
  state: QuoteStepState;
  locale: Locale;
  retained: RetainedQuote | null;
  submitting: boolean;
}) {
  const t = useTranslations("Pages.booking.quote");
  const format = useFormatter();
  const quote = retained?.quote ?? null;
  const stops = [
    {
      label: state.pickup.chosen?.label ?? t("pickup"),
      legToNext: quote
        ? {
            distance: formatDistance(quote.distanceMeters, locale),
            duration: formatDuration(quote.durationSeconds, locale),
          }
        : undefined,
    },
    { label: state.dropoff.chosen?.label ?? t("dropoff") },
  ];

  return (
    <article
      aria-labelledby="itinerary-title"
      aria-busy={submitting || undefined}
      className="relative -mx-4 flex flex-col gap-6 bg-paper-deep px-4 pt-6 pb-6 shadow-page sm:mx-0 sm:px-6"
    >
      <Signet className="absolute -top-2 right-6" />
      <h2 id="itinerary-title" className="font-display-figure text-xl">
        {t("itineraryTitle")}
      </h2>
      <RouteLine
        stops={stops}
        committed={quote !== null}
        label={t("routeLabel")}
        legLabel={t("legLabel")}
      />
      <PriceSlot
        price={quote?.total ?? null}
        locale={locale}
        label={t("priceLabel")}
        emptyLabel={t("priceEmpty")}
      />
      {quote && retained ? (
        <>
          <dl className="grid border-t border-hairline text-sm">
            <Detail term={t("pickupAt")}>
              {t("pickupAtValue", {
                date: format.dateTime(new Date(quote.pickupAt), {
                  dateStyle: "full",
                  timeStyle: "short",
                  timeZone: quote.timeZone,
                }),
              })}
            </Detail>
            <Detail term={t("distance")}>{formatDistance(quote.distanceMeters, locale)}</Detail>
            <Detail term={t("duration")}>{formatDuration(quote.durationSeconds, locale)}</Detail>
            <Detail term={t("travellers")}>
              {t("travellersValue", {
                passengers: retained.request.passengers,
                luggage: retained.request.luggage,
              })}
            </Detail>
            {/* DEC-04: HT and VAT are shown only once the server provides them. */}
            {quote.totalHt ? (
              <Detail term={t("totalHt")}>{formatMoney(quote.totalHt, locale)}</Detail>
            ) : null}
            {quote.vat ? <Detail term={t("vat")}>{formatMoney(quote.vat, locale)}</Detail> : null}
          </dl>
          <ProvisionalNotice decisions="DEC-03">
            <p>{t("provisionalPrice")}</p>
          </ProvisionalNotice>
          <p className="text-sm text-graphite">{t("nextStep")}</p>
        </>
      ) : null}
    </article>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 border-b border-hairline py-2.5">
      <dt className="text-graphite">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function QuoteFailureMessage({ failure }: { failure: QuoteFailure }) {
  const t = useTranslations("Pages.booking.quote");
  return (
    <div className="flex flex-col gap-3 border-l-2 border-rubric pl-4">
      <p className="text-rubric">{t(`failures.${failure}`)}</p>
      {failure === "leadTime" || failure === "unavailable" || failure === "noRoute" ? (
        <DirectContact />
      ) : null}
    </div>
  );
}

/** Direct channels (DEC-20, configurable in `site-identity`), then the contact page. */
function DirectContact() {
  const t = useTranslations("Pages.booking.quote");
  const { phone, email } = siteIdentity;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {phone ? (
        <li>
          {t("contactPhone")}{" "}
          <a href={`tel:${phone.replace(/\s+/g, "")}`} className={textLinkClasses}>
            {phone}
          </a>
        </li>
      ) : null}
      {email ? (
        <li>
          {t("contactEmail")}{" "}
          <a href={`mailto:${email}`} className={textLinkClasses}>
            {email}
          </a>
        </li>
      ) : null}
      <li>
        <Link href="/contact" className={textLinkClasses}>
          {t("contactLink")}
        </Link>
      </li>
    </ul>
  );
}

/** No browser key, or the Maps script refused it: no quote, never a price, a way to reach us. */
export function QuoteUnavailable() {
  const t = useTranslations("Pages.booking.quote");
  return (
    <section aria-labelledby="quote-unavailable-title" className="flex max-w-[65ch] flex-col gap-4">
      <h2 id="quote-unavailable-title" className="font-display-figure text-2xl">
        {t("unavailableTitle")}
      </h2>
      <p>{t("unavailable")}</p>
      <DirectContact />
    </section>
  );
}
