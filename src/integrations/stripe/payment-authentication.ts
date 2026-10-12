import Stripe from "stripe";

import {
  PAYMENT_INTENT_ID,
  PaymentIntentError,
  summarizePaymentIntent,
  type PaymentIntentSummary,
} from "./payment-intents";

/**
 * Read of a PaymentIntent for the customer's SCA regularisation page (VTC-042). Unlike the
 * plain summary, it also returns the PaymentIntent's `client_secret`: the one value Stripe.js
 * needs to confirm that PaymentIntent in the customer's browser. The client secret is handed to
 * that page only, never logged, never stored (docs/architecture/security.md).
 */

export type PaymentIntentForAuthentication = Readonly<{
  intent: PaymentIntentSummary;
  /** `client_secret`, null when Stripe returns none. */
  clientSecret: string | null;
}>;

export interface PaymentAuthenticationGateway {
  /** Reads a PaymentIntent with its client secret; null when Stripe does not know the id. */
  retrievePaymentIntentForAuthentication(
    paymentIntentId: string,
  ): Promise<PaymentIntentForAuthentication | null>;
}

/** The subset of the Stripe client this adapter uses (a fake in unit tests). */
export type PaymentAuthenticationStripeClient = {
  paymentIntents: Pick<Stripe["paymentIntents"], "retrieve">;
};

const CLIENT_SECRET = /^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/;

export function createStripePaymentAuthenticationGateway(
  stripe: PaymentAuthenticationStripeClient,
): PaymentAuthenticationGateway {
  return {
    async retrievePaymentIntentForAuthentication(paymentIntentId) {
      if (!PAYMENT_INTENT_ID.test(paymentIntentId)) {
        throw new PaymentIntentError("invalid_payment_intent_id");
      }
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === "resource_missing"
        ) {
          return null;
        }
        throw error;
      }
      const secret = intent.client_secret;
      return {
        intent: summarizePaymentIntent(intent),
        clientSecret: secret && CLIENT_SECRET.test(secret) ? secret : null,
      };
    },
  };
}
