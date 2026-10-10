import Stripe from "stripe";

import { stripeKeyProblem, type StripeKeyProblem } from "./keys";

/**
 * Stripe API version pinned by the adapter (ADR-0003, ADR-0006): the account default never
 * applies. It must match the version the installed SDK is typed for; upgrading the SDK is a
 * deliberate change that updates this constant (the typecheck fails otherwise).
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" satisfies Stripe.LatestApiVersion;

/**
 * Network settings of the server client, pinned to the stripe-node defaults so that the longest
 * possible duration of one request is known (technical values, not business rules). The SDK
 * retries a failed request up to `STRIPE_MAX_NETWORK_RETRIES` times with the same idempotency
 * key, waiting at most `STRIPE_MAX_RETRY_DELAY_MS` between tries.
 */
export const STRIPE_TIMEOUT_MS = 80_000;
export const STRIPE_MAX_NETWORK_RETRIES = 2;
/** stripe-node's cap on the delay before a network retry (`MAX_NETWORK_RETRY_DELAY_SEC`). */
export const STRIPE_MAX_RETRY_DELAY_MS = 5_000;

/**
 * Longest time one Stripe call of this client can stay in flight, retries included: past it,
 * the call has either reached Stripe or failed for good.
 */
export const STRIPE_REQUEST_MAX_DURATION_MS =
  STRIPE_TIMEOUT_MS * (1 + STRIPE_MAX_NETWORK_RETRIES) +
  STRIPE_MAX_RETRY_DELAY_MS * STRIPE_MAX_NETWORK_RETRIES;

export type StripeConfigErrorReason = "not_configured" | StripeKeyProblem;

/** The server key is missing or not a test mode key. The message never contains the key. */
export class StripeConfigError extends Error {
  constructor(readonly reason: StripeConfigErrorReason) {
    super(`Stripe is not usable: ${reason}`);
    this.name = "StripeConfigError";
  }
}

/**
 * Server Stripe client, test mode only (BR-44): a live key, or any value that is not a test
 * secret or restricted key, is refused before a client exists.
 */
export function createStripeClient(secretKey: string | undefined): Stripe {
  if (!secretKey) throw new StripeConfigError("not_configured");
  const problem = stripeKeyProblem("secret", secretKey);
  if (problem) throw new StripeConfigError(problem);

  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: STRIPE_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    typescript: true,
  });
}
