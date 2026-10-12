import "server-only";

import type Stripe from "stripe";

import { serverEnv } from "@/lib/env/server";

import { createStripeClient } from "./client";
import {
  createStripePaymentAuthenticationGateway,
  type PaymentAuthenticationGateway,
} from "./payment-authentication";
import { createStripePaymentIntentGateway, type PaymentIntentGateway } from "./payment-intents";
import { createStripePaymentSetupGateway, type PaymentSetupGateway } from "./setup-intents";
import { createStripeWebhookVerifier, type StripeWebhookVerifier } from "./webhooks";

export {
  STRIPE_API_VERSION,
  STRIPE_REQUEST_MAX_DURATION_MS,
  StripeConfigError,
  type StripeConfigErrorReason,
} from "./client";
export {
  type PaymentAuthenticationGateway,
  type PaymentIntentForAuthentication,
} from "./payment-authentication";
export {
  PAYMENT_INTENT_ID,
  PaymentIntentError,
  type OffSessionChargeInput,
  type OffSessionChargeResult,
  type PaymentIntentGateway,
  type PaymentIntentSummary,
} from "./payment-intents";
export {
  PaymentSetupError,
  SETUP_INTENT_ID,
  stripeUnavailableReason,
  type CreatedSetupIntent,
  type PaymentSetupGateway,
  type SetupIntentSummary,
} from "./setup-intents";
export {
  StripeWebhookError,
  type StripeWebhookErrorCode,
  type StripeWebhookEvent,
  type StripeWebhookVerifier,
} from "./webhooks";

let client: Stripe | undefined;
let verifier: StripeWebhookVerifier | undefined;
let paymentSetup: PaymentSetupGateway | undefined;
let paymentIntents: PaymentIntentGateway | undefined;
let paymentAuthentication: PaymentAuthenticationGateway | undefined;

/**
 * Server Stripe client (test mode only), created on first use: neither import nor `next build`
 * reads the environment. Without `STRIPE_SECRET_KEY`, or with a key that is not a test key, the
 * call fails with a `StripeConfigError`. Tests mock this module rather than reach Stripe.
 */
export function stripeClient(): Stripe {
  client ??= createStripeClient(serverEnv().STRIPE_SECRET_KEY);
  return client;
}

/** Webhook verifier; `STRIPE_WEBHOOK_SECRET` is read on each verification. */
export function stripeWebhooks(): StripeWebhookVerifier {
  verifier ??= createStripeWebhookVerifier({ secret: () => serverEnv().STRIPE_WEBHOOK_SECRET });
  return verifier;
}

/**
 * SetupIntent gateway (VTC-031) on the server client: same lazy, test-mode-only rules as
 * `stripeClient()` (a `StripeConfigError` without a usable test key).
 */
export function stripePaymentSetup(): PaymentSetupGateway {
  paymentSetup ??= createStripePaymentSetupGateway(stripeClient());
  return paymentSetup;
}

/**
 * PaymentIntent gateway (VTC-033) on the server client: same lazy, test-mode-only rules as
 * `stripeClient()` (a `StripeConfigError` without a usable test key).
 */
export function stripePaymentIntents(): PaymentIntentGateway {
  paymentIntents ??= createStripePaymentIntentGateway(stripeClient());
  return paymentIntents;
}

/**
 * PaymentIntent read with its client secret, for the customer's SCA regularisation page only
 * (VTC-042): same lazy, test-mode-only rules as `stripeClient()`.
 */
export function stripePaymentAuthentication(): PaymentAuthenticationGateway {
  paymentAuthentication ??= createStripePaymentAuthenticationGateway(stripeClient());
  return paymentAuthentication;
}
