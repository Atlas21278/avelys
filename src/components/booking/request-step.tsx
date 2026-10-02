"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { ProvisionalNotice } from "@/components/site/provisional-notice";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, TextArea } from "@/components/ui/field";
import { textLinkClasses } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import { CUSTOMER_NOTES_MAX_LENGTH } from "@/domain/booking/request-schema";
import { CONTACT_FAILURES, type ContactField, type RequestFailure } from "@/lib/booking-request";
import { formatMoney } from "@/lib/money";
import type { RetainedQuote } from "@/lib/quote-step-state";
import {
  startCardSetup,
  submitRequest,
  type CardConfirmation,
  type RequestFlowDeps,
  type RequestStore,
} from "@/lib/request-step-flow";
import {
  displayedTotalOf,
  isEmailLocked,
  type RequestStepState,
  type TextContactField,
} from "@/lib/request-step-state";

import { CardField } from "./card-field";
import { DirectContact } from "./quote-step";

type RequestStepProps = {
  quote: RetainedQuote;
  store: RequestStore;
  stripePublishableKey: string;
  locale: "fr" | "en";
};

export function useRequestState(store: RequestStore): RequestStepState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Journey id of the payment setup (review note of VTC-045): drawn in the browser only. */
export const newSubmissionId = () => crypto.randomUUID();

/**
 * Step 2 of the public booking flow (VTC-047): contact details, card saved through Stripe's
 * Payment Element (SetupIntent, no charge), terms, then `POST /api/v1/bookings`. The browser
 * sends no amount of its own: `displayedTotal` is the server total the visitor saw (or the new
 * server total they confirmed after `PRICE_CHANGED`), used by the server only to detect a change.
 * The rules (email lock, `submissionId`, double submission, price change) live in
 * `src/lib/request-step-state.ts` and `src/lib/request-step-flow.ts`.
 */
export function RequestStep({ quote, store, stripePublishableKey, locale }: RequestStepProps) {
  const t = useTranslations("Pages.booking.request");
  const state = useRequestState(store);
  const [stripeUnavailable, setStripeUnavailable] = useState(false);
  const confirmRef = useRef<(() => Promise<CardConfirmation>) | null>(null);
  const onConfirmReady = useCallback((confirm: (() => Promise<CardConfirmation>) | null) => {
    confirmRef.current = confirm;
  }, []);
  const onStripeUnavailable = useCallback(() => setStripeUnavailable(true), []);

  const deps: RequestFlowDeps = {
    store,
    fetch: (...args) => fetch(...args),
    locale,
    newId: newSubmissionId,
  };
  const busy = state.pending !== null;
  const issue = (field: ContactField) =>
    state.issues.includes(field) ? t(`issues.${field}`) : undefined;
  const setField = (field: TextContactField) => (value: string) =>
    store.dispatch({ type: "field", field, value, submissionId: newSubmissionId() });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitRequest(deps, { quote, confirmCard: confirmRef.current, acceptPrice: false });
  }

  function acceptNewPrice() {
    void submitRequest(deps, { quote, confirmCard: confirmRef.current, acceptPrice: true });
  }

  if (stripeUnavailable) return <RequestUnavailable />;

  const total = displayedTotalOf(state, quote.quote.total);
  const { contact, card } = state;
  const numberLabel =
    contact.transportKind === "TRAIN" ? t("transportNumberTrain") : t("transportNumberFlight");

  return (
    <section aria-labelledby="request-title" className="flex max-w-[40rem] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 id="request-title" className="font-display-figure text-2xl">
          {t("title")}
        </h2>
        <p className="text-graphite">{t("lead")}</p>
      </header>

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-8">
        <fieldset className="flex flex-col gap-5" disabled={state.pending === "submit"}>
          <legend className="mb-5 font-display-figure text-xl">{t("contactTitle")}</legend>
          <Field label={t("name")} error={issue("name")} required>
            <Input
              autoComplete="name"
              value={contact.name}
              onChange={(event) => setField("name")(event.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <Field
              label={t("email")}
              error={issue("email")}
              hint={isEmailLocked(state) ? t("emailLocked") : undefined}
              required
            >
              <Input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={contact.email}
                readOnly={isEmailLocked(state)}
                onChange={(event) => setField("email")(event.target.value)}
              />
            </Field>
            {isEmailLocked(state) ? (
              <Button
                variant="quiet"
                className="self-start"
                disabled={busy}
                onClick={() =>
                  store.dispatch({ type: "changeEmail", submissionId: newSubmissionId() })
                }
              >
                {t("changeEmail")}
              </Button>
            ) : null}
          </div>
          <Field
            label={t("phone")}
            hint={t("phoneHint")}
            error={issue("phone")}
            optionalLabel={t("optional")}
          >
            <Input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={contact.phone}
              onChange={(event) => setField("phone")(event.target.value)}
            />
          </Field>
          <Field
            label={t("notes")}
            hint={t("notesHint")}
            error={issue("notes")}
            optionalLabel={t("optional")}
          >
            <TextArea
              rows={3}
              value={contact.notes}
              maxLength={CUSTOMER_NOTES_MAX_LENGTH}
              onChange={(event) => setField("notes")(event.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-5" disabled={state.pending === "submit"}>
          <legend className="mb-5 font-display-figure text-xl">{t("transportTitle")}</legend>
          <Field label={t("transportKind")} optionalLabel={t("optional")}>
            <Select
              value={contact.transportKind}
              onChange={(event) =>
                store.dispatch({
                  type: "transportKind",
                  value:
                    event.target.value === "FLIGHT" || event.target.value === "TRAIN"
                      ? event.target.value
                      : "",
                })
              }
            >
              <option value="">{t("transportNone")}</option>
              <option value="FLIGHT">{t("transportFlight")}</option>
              <option value="TRAIN">{t("transportTrain")}</option>
            </Select>
          </Field>
          {contact.transportKind === "" ? null : (
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <Field
                label={numberLabel}
                error={issue("transportNumber")}
                optionalLabel={t("optional")}
              >
                <Input
                  value={contact.transportNumber}
                  maxLength={32}
                  onChange={(event) => setField("transportNumber")(event.target.value)}
                />
              </Field>
              <Field
                label={t("transportOrigin")}
                error={issue("transportOrigin")}
                optionalLabel={t("optional")}
              >
                <Input
                  value={contact.transportOrigin}
                  maxLength={120}
                  onChange={(event) => setField("transportOrigin")(event.target.value)}
                />
              </Field>
              <Field
                label={t("transportTerminal")}
                error={issue("transportTerminal")}
                optionalLabel={t("optional")}
                className="sm:col-span-2"
              >
                <Input
                  value={contact.transportTerminal}
                  maxLength={120}
                  onChange={(event) => setField("transportTerminal")(event.target.value)}
                />
              </Field>
              <Field
                label={t("transportDate")}
                error={issue("transportScheduled")}
                optionalLabel={t("optional")}
              >
                <Input
                  type="date"
                  value={contact.transportDate}
                  onChange={(event) => setField("transportDate")(event.target.value)}
                />
              </Field>
              <Field
                label={t("transportTime")}
                hint={t("transportTimeHint")}
                optionalLabel={t("optional")}
              >
                <Input
                  type="time"
                  value={contact.transportTime}
                  onChange={(event) => setField("transportTime")(event.target.value)}
                />
              </Field>
            </div>
          )}
        </fieldset>

        <section aria-labelledby="card-title" className="flex flex-col gap-4">
          <h3 id="card-title" className="font-display-figure text-xl">
            {t("cardTitle")}
          </h3>
          <p className="text-sm text-graphite">{t("cardLead")}</p>
          {card.kind === "none" || card.kind === "creating" ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="self-start"
                loading={card.kind === "creating"}
                disabled={busy}
                onClick={() => void startCardSetup(deps)}
              >
                {t("cardStart")}
              </Button>
              <p className="text-sm text-graphite">{t("cardStartHint")}</p>
            </div>
          ) : null}
          {card.kind === "entry" ? (
            <CardField
              publishableKey={stripePublishableKey}
              clientSecret={card.clientSecret}
              locale={locale}
              onConfirmReady={onConfirmReady}
              onUnavailable={onStripeUnavailable}
            />
          ) : null}
          {card.kind === "saved" ? (
            <p role="status" className="flex items-center gap-2">
              <CheckMark />
              {t("cardSaved")}
            </p>
          ) : null}
          <div role="alert" className="empty:hidden">
            {state.cardMessage ? (
              <p className="border-l-2 border-rubric pl-4 text-rubric">{state.cardMessage}</p>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-2">
          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={contact.termsAccepted}
              disabled={state.pending === "submit"}
              aria-invalid={state.issues.includes("terms") || undefined}
              aria-describedby={state.issues.includes("terms") ? "terms-error" : undefined}
              onChange={(event) =>
                store.dispatch({ type: "terms", accepted: event.target.checked })
              }
              className="mt-1 size-5 shrink-0 accent-ink"
            />
            <span>
              {t.rich("terms", {
                link: (chunks) => (
                  <Link href="/cgv" className={textLinkClasses} target="_blank" rel="noopener">
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>
          {issue("terms") ? (
            <p id="terms-error" className="text-sm text-rubric">
              {issue("terms")}
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-y border-hairline py-3">
          <dt className="text-graphite">{t("totalLabel")}</dt>
          <dd className="font-display-figure text-xl">{formatMoney(total, locale)}</dd>
        </dl>

        {state.issues.length > 0 ? (
          <p role="alert" className="text-sm text-rubric">
            {t("issuesSummary")}
          </p>
        ) : null}

        <div role="alert" className="empty:hidden">
          {state.failure && !(state.failure === "priceChanged" && state.priceChange) ? (
            <FailureMessage failure={state.failure} />
          ) : null}
        </div>

        {state.priceChange ? (
          <div className="flex flex-col gap-4 border border-ink px-4 py-4" role="alert">
            <p className="small-caps-label text-graphite">{t("priceChangedTitle")}</p>
            <p>{t("priceChanged", { price: formatMoney(state.priceChange, locale) })}</p>
            <Button size="lg" className="w-full sm:w-auto sm:self-start" onClick={acceptNewPrice}>
              {t("submitNewPrice")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Button
              type="submit"
              size="lg"
              loading={state.pending === "submit"}
              disabled={busy}
              className="w-full sm:w-auto sm:self-start"
            >
              {t("submit")}
            </Button>
            <p className="text-sm text-graphite">{t("note")}</p>
          </div>
        )}
      </form>
    </section>
  );
}

function FailureMessage({ failure }: { failure: RequestFailure }) {
  const t = useTranslations("Pages.booking.request");
  return (
    <div className="flex flex-col gap-3 border-l-2 border-rubric pl-4">
      <p className="text-rubric">{t(`failures.${failure}`)}</p>
      {CONTACT_FAILURES.has(failure) ? <DirectContact /> : null}
    </div>
  );
}

function CheckMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none">
      <path d="m3 8.5 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** No publishable key, or Stripe.js could not load: no card step, a way to reach us. */
export function RequestUnavailable() {
  const t = useTranslations("Pages.booking.request");
  return (
    <section
      aria-labelledby="request-unavailable-title"
      className="flex max-w-[65ch] flex-col gap-4"
    >
      <h2 id="request-unavailable-title" className="font-display-figure text-2xl">
        {t("cardUnavailableTitle")}
      </h2>
      <p>{t("cardUnavailable")}</p>
      <DirectContact />
    </section>
  );
}

/** Confirmation: the public reference and the reminder that nothing is charged before approval. */
export function RequestSent({ reference }: { reference: string }) {
  const t = useTranslations("Pages.booking.request.confirmation");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section aria-labelledby="request-sent-title" className="flex max-w-[65ch] flex-col gap-6">
      <h2
        id="request-sent-title"
        ref={heading}
        tabIndex={-1}
        className="font-display-figure text-3xl focus-visible:outline-none"
      >
        {t("title")}
      </h2>
      <dl className="flex flex-col gap-1 border-y border-hairline py-4">
        <dt className="small-caps-label text-graphite">{t("reference")}</dt>
        <dd className="font-display-figure text-2xl tracking-wide">{reference}</dd>
      </dl>
      {/* The fact comes from ADR-0006 (no charge before approval); the wording is provisional. */}
      <ProvisionalNotice>
        <p>{t("status")}</p>
      </ProvisionalNotice>
      <p className="text-graphite">{t("keep")}</p>
    </section>
  );
}
