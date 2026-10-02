"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  authenticatePayment,
  stripeBrowser,
  type AuthenticationStep,
} from "@/integrations/stripe/browser";

type RegularizationFormProps = {
  publishableKey: string;
  /** PaymentIntent client secret: given to Stripe.js only, never sent anywhere else. */
  clientSecret: string;
  paymentMethodId: string;
  step: AuthenticationStep;
  /** Required by Stripe.js; a card never redirects. The site home, never the link itself. */
  returnUrl: string;
  /** Rendered once Stripe reports the payment settled (or being processed). */
  settled: React.ReactNode;
  /** Rendered when Stripe.js cannot be loaded. */
  unavailable: React.ReactNode;
};

type State =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "working" }
  | { kind: "failed"; message: string | null }
  | { kind: "settled" }
  | { kind: "unavailable" };

/**
 * Authentication button of the SCA regularisation page (VTC-042). Stripe.js confirms the
 * existing PaymentIntent with the saved card (or runs its pending action) and opens the bank's
 * 3-D Secure window: no card field, no amount, nothing sent to our servers. The outcome shown
 * here is informative; the booking is confirmed by the webhook (BR-41).
 */
export function RegularizationForm({
  publishableKey,
  clientSecret,
  paymentMethodId,
  step,
  returnUrl,
  settled,
  unavailable,
}: RegularizationFormProps) {
  const t = useTranslations("Regularization");
  const [state, setState] = useState<State>({ kind: "loading" });
  const status = useRef<HTMLDivElement>(null);

  const stripe = useMemo(() => {
    const promise = stripeBrowser(publishableKey);
    promise.catch(() => undefined);
    return promise;
  }, [publishableKey]);

  useEffect(() => {
    let active = true;
    stripe.then(
      (loaded) => {
        if (active) setState(loaded ? { kind: "ready" } : { kind: "unavailable" });
      },
      () => {
        if (active) setState({ kind: "unavailable" });
      },
    );
    return () => {
      active = false;
    };
  }, [stripe]);

  useEffect(() => {
    if (state.kind === "failed" || state.kind === "settled") status.current?.focus();
  }, [state.kind]);

  async function authenticate() {
    setState({ kind: "working" });
    const loaded = await stripe.catch(() => null);
    if (!loaded) {
      setState({ kind: "unavailable" });
      return;
    }
    const result = await authenticatePayment(loaded, {
      step,
      clientSecret,
      paymentMethodId,
      returnUrl,
    });
    setState(
      result.outcome === "settled"
        ? { kind: "settled" }
        : { kind: "failed", message: result.message },
    );
  }

  if (state.kind === "settled") {
    return (
      <div ref={status} tabIndex={-1} role="status" className="outline-none">
        {settled}
      </div>
    );
  }
  if (state.kind === "unavailable") return <div role="status">{unavailable}</div>;

  return (
    <div className="flex flex-col items-start gap-4">
      <Button
        size="lg"
        onClick={() => void authenticate()}
        loading={state.kind === "working"}
        disabled={state.kind === "loading"}
      >
        {t("authenticate")}
      </Button>
      {state.kind === "loading" ? (
        <p role="status" className="text-sm text-graphite">
          {t("loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <div
          ref={status}
          tabIndex={-1}
          role="alert"
          className="flex max-w-[60ch] flex-col gap-1 border-l-2 border-rubric pl-4 outline-none"
        >
          {state.message ? <p className="text-rubric">{state.message}</p> : null}
          <p>{t("failed")}</p>
        </div>
      ) : null}
    </div>
  );
}
