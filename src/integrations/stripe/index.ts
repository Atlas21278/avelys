import "server-only";

import type Stripe from "stripe";

import { serverEnv } from "@/lib/env/server";

import { createStripeClient } from "./client";
import { createStripePaymentSetupGateway, type PaymentSetupGateway } from "./setup-intents";
import { createStripeWebhookVerifier, type StripeWebhookVerifier } from "./webhooks";

export { STRIPE_API_VERSION, StripeConfigError, type StripeConfigErrorReason } from "./client";
export {
  PaymentSetupError,
  SETUP_INTENT_ID,
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
