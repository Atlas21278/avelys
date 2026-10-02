"use client";

import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

import type { ServiceArea } from "@/domain/geo/service-area";
import type { Locale } from "@/i18n/routing";
import type { BookingSearch } from "@/lib/booking-search";
import type { RetainedQuote } from "@/lib/quote-step-state";
import { createRequestStore } from "@/lib/request-step-flow";
import { initialRequestStepState } from "@/lib/request-step-state";

import { QuoteStep } from "./quote-step";
import {
  RequestSent,
  RequestStep,
  RequestUnavailable,
  newSubmissionId,
  useRequestState,
} from "./request-step";

type BookingFlowProps = {
  search: BookingSearch;
  mapsBrowserKey: string;
  serviceArea: ServiceArea;
  /** Test-mode publishable key read at request time; null = the request cannot be sent online. */
  stripePublishableKey: string | null;
};

/**
 * Public booking flow (VTC-046, VTC-047): the server quote, then, once a quote is shown, the
 * request step. The request step is bound to the quote's fingerprint: any change of the trip,
 * time, travellers or price after the card was saved restarts its card step with a new
 * `submissionId` (review note of VTC-045). Once the request is sent, only the confirmation stays.
 */
export function BookingFlow({
  search,
  mapsBrowserKey,
  serviceArea,
  stripePublishableKey,
}: BookingFlowProps) {
  const locale = useLocale() as Locale;
  const [retained, setRetained] = useState<RetainedQuote | null>(null);
  const [store] = useState(() => createRequestStore(initialRequestStepState(newSubmissionId())));
  const state = useRequestState(store);

  useEffect(() => {
    if (retained) {
      store.dispatch({
        type: "quote",
        fingerprint: retained.fingerprint,
        submissionId: newSubmissionId(),
      });
    }
  }, [retained, store]);

  if (state.reference !== null) return <RequestSent reference={state.reference} />;

  // The step shows only for the quote it is bound to (the effect above binds it after render).
  const bound = retained !== null && state.fingerprint === retained.fingerprint ? retained : null;

  return (
    <div className="flex flex-col gap-20">
      <QuoteStep
        search={search}
        mapsBrowserKey={mapsBrowserKey}
        serviceArea={serviceArea}
        onQuoteChange={setRetained}
      />
      {bound === null ? null : stripePublishableKey ? (
        <RequestStep
          quote={bound}
          store={store}
          stripePublishableKey={stripePublishableKey}
          locale={locale}
        />
      ) : (
        <RequestUnavailable />
      )}
    </div>
  );
}
