"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import {
  confirmCardSetup,
  paymentElementsOptions,
  returnUrlOf,
  stripeBrowser,
} from "@/integrations/stripe/browser";
import type { CardConfirmation } from "@/lib/request-step-flow";

type ConfirmCard = () => Promise<CardConfirmation>;

type CardFieldProps = {
  publishableKey: string;
  clientSecret: string;
  locale: "fr" | "en";
  /** Receives the confirmation function once Stripe.js and the element are ready, null before. */
  onConfirmReady: (confirm: ConfirmCard | null) => void;
  /** Stripe.js could not be loaded (network, key refused). */
  onUnavailable: () => void;
};

/**
 * Stripe Payment Element for the SetupIntent of the request step (VTC-047). The card is typed in
 * Stripe's iframe and confirmed by Stripe.js: its data never reaches our pages' code nor our
 * servers (BR-40). Strong customer authentication, when the bank asks for it, opens in Stripe's
 * own window; no redirection happens for a card (`redirect: "if_required"`).
 */
export function CardField({
  publishableKey,
  clientSecret,
  locale,
  onConfirmReady,
  onUnavailable,
}: CardFieldProps) {
  const stripe = useMemo(() => {
    const promise = stripeBrowser(publishableKey);
    promise.catch(() => undefined);
    return promise;
  }, [publishableKey]);

  useEffect(() => {
    let active = true;
    stripe.then(
      (loaded) => {
        if (active && loaded === null) onUnavailable();
      },
      () => {
        if (active) onUnavailable();
      },
    );
    return () => {
      active = false;
    };
  }, [stripe, onUnavailable]);

  const options = useMemo(
    () => paymentElementsOptions(clientSecret, locale),
    [clientSecret, locale],
  );

  return (
    // A new SetupIntent mounts a new Elements group (its client secret is fixed at creation).
    <Elements key={clientSecret} stripe={stripe} options={options}>
      <CardElement
        clientSecret={clientSecret}
        onConfirmReady={onConfirmReady}
        onUnavailable={onUnavailable}
      />
    </Elements>
  );
}

function CardElement({
  clientSecret,
  onConfirmReady,
  onUnavailable,
}: Pick<CardFieldProps, "clientSecret" | "onConfirmReady" | "onUnavailable">) {
  const t = useTranslations("Pages.booking.request");
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!stripe || !elements || !ready) {
      onConfirmReady(null);
      return;
    }
    onConfirmReady(() =>
      confirmCardSetup(stripe, {
        elements,
        clientSecret,
        // Without the query string: it may hold free-text addresses from the home search.
        returnUrl: returnUrlOf(window.location),
      }),
    );
    return () => onConfirmReady(null);
  }, [stripe, elements, ready, clientSecret, onConfirmReady]);

  return (
    <div className="flex flex-col gap-2">
      {ready ? null : (
        <p role="status" className="text-sm text-graphite">
          {t("cardLoading")}
        </p>
      )}
      <PaymentElement
        options={{ layout: "tabs", paymentMethodOrder: ["card"] }}
        onReady={() => setReady(true)}
        onLoadError={onUnavailable}
      />
    </div>
  );
}
