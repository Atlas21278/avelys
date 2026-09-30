import type { SetupIntentResult, Stripe, StripeElementsOptions } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";

import type { CardConfirmation } from "@/lib/request-step-flow";

import { isTestModePublishableKey } from "./keys";

/**
 * Browser side of Stripe (VTC-047): loads Stripe.js for the Payment Element of the public
 * request step and reads the result of `stripe.confirmSetup`. The card number and CVC stay in
 * Stripe's iframes; our code only ever sees the SetupIntent id (BR-40).
 *
 * `@stripe/stripe-js/pure` does not inject the script on import: Stripe.js is only fetched from
 * js.stripe.com when the visitor reaches the card step (Master Spec §22, limit client JS).
 */

export class StripeBrowserKeyError extends Error {
  override readonly name = "StripeBrowserKeyError";
}

const loaded = new Map<string, Promise<Stripe | null>>();

/**
 * Stripe.js for a publishable key, loaded once per key. Test mode only (BR-44): a live or
 * unknown key is refused here too, without echoing it, even though the environment schema
 * already refuses it.
 */
export function stripeBrowser(publishableKey: string): Promise<Stripe | null> {
  if (!isTestModePublishableKey(publishableKey)) {
    return Promise.reject(new StripeBrowserKeyError("Stripe publishable key is not a test key"));
  }
  let stripe = loaded.get(publishableKey);
  if (!stripe) {
    stripe = loadStripe(publishableKey);
    // A failed load (network) may be retried on the next attempt.
    stripe.catch(() => loaded.delete(publishableKey));
    loaded.set(publishableKey, stripe);
  }
  return stripe;
}

/** Elements options of the request step: card only (as the SetupIntent), in the page language. */
export function paymentElementsOptions(
  clientSecret: string,
  locale: "fr" | "en",
): StripeElementsOptions {
  return {
    clientSecret,
    locale,
    // DESIGN.md tokens: ink on ivory, rubric for errors, square print corners.
    appearance: {
      theme: "flat",
      variables: {
        colorPrimary: "#1f2124",
        colorBackground: "#f4efe6",
        colorText: "#1f2124",
        colorTextSecondary: "#5b5852",
        colorDanger: "#9c2b20",
        borderRadius: "0px",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSizeBase: "16px",
      },
      rules: {
        ".Input": { borderBottom: "1px solid #8c877e", backgroundColor: "transparent" },
        ".Input:focus": { borderBottom: "1px solid #1f2124", boxShadow: "0 2px 0 0 #1f2124" },
      },
    },
  };
}

/** Stripe.js errors whose localised message is meant for the customer (card or input). */
const CUSTOMER_FACING_ERRORS = new Set(["card_error", "validation_error"]);

/**
 * Reads `stripe.confirmSetup` (`redirect: "if_required"`). A succeeded SetupIntent gives its id;
 * a card or input error gives Stripe's localised message, shown as is; anything else (API,
 * rate limit, unexpected status) is a generic failure, never a raw technical message.
 */
export function confirmationOf(result: SetupIntentResult): CardConfirmation {
  if (result.error) {
    const message = result.error.message;
    return {
      ok: false,
      message: CUSTOMER_FACING_ERRORS.has(result.error.type) && message ? message : null,
    };
  }
  const { setupIntent } = result;
  return setupIntent.status === "succeeded"
    ? { ok: true, paymentSetupId: setupIntent.id }
    : { ok: false, message: null };
}
