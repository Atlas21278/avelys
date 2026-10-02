import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed token of the SCA regularisation link (VTC-042, DEC-27, docs/product/payments.md).
 * Pure: the key is injected, no clock, no I/O. The token carries the Payment id and the charge
 * attempt it was issued for, signed with HMAC-SHA256: a new attempt (manual retry, VTC-041)
 * makes every earlier link unusable without storing anything.
 *
 * Shape: `base64url("v1:{paymentId}:{attempt}")` followed by the 43 characters of the
 * base64url HMAC, with no separator. Only `[A-Za-z0-9_-]`: no dot (the locale proxy skips paths
 * with a dot), nothing to escape in a URL or an email.
 *
 * The token holds no expiry: the link is valid only while the Payment state allows it (checked
 * by the server). An absolute deadline comes with DEC-13.
 */

const VERSION = "v1";
/** HMAC-SHA256 is 32 bytes: 43 base64url characters without padding. */
const SIGNATURE_LENGTH = 43;
/** Generous bound: a cuid2 id and a 9-digit attempt encode to well under this. */
const MAX_TOKEN_LENGTH = 200;
/** Minimum key length, as required for `PAYMENT_LINK_SECRET`. */
export const MIN_REGULARIZATION_KEY_LENGTH = 32;

const TOKEN_ALPHABET = /^[A-Za-z0-9_-]+$/;
const PAYMENT_ID = /^[a-z0-9]{1,64}$/;
const ATTEMPT = /^[1-9][0-9]{0,8}$/;

export type RegularizationClaim = Readonly<{ paymentId: string; attempt: number }>;

/** The signing key is missing or too short: never echoed. */
export class RegularizationKeyError extends Error {
  override readonly name = "RegularizationKeyError";

  constructor() {
    super(`Regularisation link key must be at least ${MIN_REGULARIZATION_KEY_LENGTH} characters`);
  }
}

function assertKey(key: string): void {
  if (key.length < MIN_REGULARIZATION_KEY_LENGTH) throw new RegularizationKeyError();
}

function signature(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update(payload, "utf8").digest();
}

/** Signs a claim. Throws a `RangeError` on an invalid id or attempt, never a token for them. */
export function signRegularizationToken(claim: RegularizationClaim, key: string): string {
  assertKey(key);
  if (!PAYMENT_ID.test(claim.paymentId)) throw new RangeError("invalid paymentId");
  if (!ATTEMPT.test(String(claim.attempt))) throw new RangeError("invalid attempt");
  const payload = `${VERSION}:${claim.paymentId}:${claim.attempt}`;
  return (
    Buffer.from(payload, "utf8").toString("base64url") +
    signature(payload, key).toString("base64url")
  );
}

/**
 * The claim of a well-formed token signed with `key`, null otherwise (malformed, altered,
 * another key). The signature is compared in constant time; the caller never learns why a token
 * was refused.
 */
export function verifyRegularizationToken(token: string, key: string): RegularizationClaim | null {
  assertKey(key);
  if (
    token.length <= SIGNATURE_LENGTH ||
    token.length > MAX_TOKEN_LENGTH ||
    !TOKEN_ALPHABET.test(token)
  ) {
    return null;
  }
  const encodedPayload = token.slice(0, -SIGNATURE_LENGTH);
  const encodedSignature = token.slice(-SIGNATURE_LENGTH);
  const given = Buffer.from(encodedSignature, "base64url");
  const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  // Canonical encodings only: base64url ignores trailing bits, so a variant spelling of the same
  // bytes would otherwise verify too. One link, one spelling.
  if (
    Buffer.from(payload, "utf8").toString("base64url") !== encodedPayload ||
    given.toString("base64url") !== encodedSignature
  ) {
    return null;
  }

  const expected = signature(payload, key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const [version, paymentId, attempt, ...rest] = payload.split(":");
  if (
    version !== VERSION ||
    rest.length > 0 ||
    paymentId === undefined ||
    attempt === undefined ||
    !PAYMENT_ID.test(paymentId) ||
    !ATTEMPT.test(attempt)
  ) {
    return null;
  }
  return { paymentId, attempt: Number(attempt) };
}
