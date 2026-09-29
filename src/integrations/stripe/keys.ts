/**
 * Test mode guard for Stripe keys (VTC-030, BR-44). Pure, without I/O: shared by the environment
 * schema and the client factory. Only test mode keys are accepted, in every environment; enabling
 * live mode is a separate CRITICAL ticket. A key is never echoed, only classified.
 */

export type StripeKeyKind = "secret" | "publishable";

/** Why a key is refused: a live key, or anything that is not a recognisable test key. */
export type StripeKeyProblem = "live_key" | "unknown_format";

const TEST_KEY: Readonly<Record<StripeKeyKind, RegExp>> = {
  // Standard secret key or restricted key.
  secret: /^(?:sk|rk)_test_[A-Za-z0-9]+$/,
  publishable: /^pk_test_[A-Za-z0-9]+$/,
};

const LIVE_KEY: Readonly<Record<StripeKeyKind, RegExp>> = {
  secret: /^(?:sk|rk)_live_/,
  publishable: /^pk_live_/,
};

/** `null` for an accepted test mode key, the reason of the refusal otherwise. */
export function stripeKeyProblem(kind: StripeKeyKind, key: string): StripeKeyProblem | null {
  if (TEST_KEY[kind].test(key)) return null;
  return LIVE_KEY[kind].test(key) ? "live_key" : "unknown_format";
}

export function isTestModeSecretKey(key: string): boolean {
  return stripeKeyProblem("secret", key) === null;
}

export function isTestModePublishableKey(key: string): boolean {
  return stripeKeyProblem("publishable", key) === null;
}

/** Webhook signing secret (`whsec_…`), from the Dashboard endpoint or `stripe listen`. */
export function isWebhookSigningSecret(secret: string): boolean {
  return /^whsec_[A-Za-z0-9]+$/.test(secret);
}
