import Stripe from "stripe";

import { stripeKeyProblem, type StripeKeyProblem } from "./keys";

/**
 * Stripe API version pinned by the adapter (ADR-0003, ADR-0006): the account default never
 * applies. It must match the version the installed SDK is typed for; upgrading the SDK is a
 * deliberate change that updates this constant (the typecheck fails otherwise).
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" satisfies Stripe.LatestApiVersion;

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
    typescript: true,
  });
}
