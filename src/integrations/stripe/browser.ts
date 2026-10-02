import type {
  SetupIntentResult,
  Stripe,
  StripeElements,
  StripeElementsOptions,
} from "@stripe/stripe-js";
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

/**
 * `return_url` of `stripe.confirmSetup`: the booking page without its query string. The home page
 * search puts free-text addresses in the query (`?pickup=…&dropoff=…`); they must not travel to
 * Stripe. Never used for a card (no redirection), but required by Stripe.js.
 */
export function returnUrlOf(location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}`;
}

/** The two Stripe.js calls the card confirmation uses (mockable). */
export interface SetupIntentClient {
  confirmSetup(options: {
    elements: StripeElements;
    redirect: "if_required";
    confirmParams: { return_url: string };
  }): Promise<SetupIntentResult>;
  retrieveSetupIntent(clientSecret: string): Promise<SetupIntentResult>;
}

/**
 * Confirms the SetupIntent of the Payment Element. A card refusal keeps Stripe's localised
 * message. Any other outcome (Stripe.js throwing, a lost answer, a retry refused because the
 * SetupIntent already succeeded: `setup_intent_unexpected_state`) reads the SetupIntent back:
 * if it succeeded, its id is used; otherwise a generic failure, whose message suggests
 * restarting the card step with « Modifier l'email ».
 */
export async function confirmCardSetup(
  stripe: SetupIntentClient,
  input: { elements: StripeElements; clientSecret: string; returnUrl: string },
): Promise<CardConfirmation> {
  try {
    const confirmation = confirmationOf(
      await stripe.confirmSetup({
        elements: input.elements,
        redirect: "if_required",
        confirmParams: { return_url: input.returnUrl },
      }),
    );
    if (confirmation.ok || confirmation.message !== null) return confirmation;
  } catch {
    // Read the SetupIntent back below.
  }
  try {
    const retrieved = await stripe.retrieveSetupIntent(input.clientSecret);
    if (!retrieved.error && retrieved.setupIntent.status === "succeeded") {
      return { ok: true, paymentSetupId: retrieved.setupIntent.id };
    }
  } catch {
    // Generic failure below.
  }
  return { ok: false, message: null };
}
