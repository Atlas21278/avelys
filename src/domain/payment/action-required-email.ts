/**
 * Customer email "payment authentication required" (VTC-044, DEC-27): deduplication key, pure.
 *
 * One email per Payment **and charge attempt**: a replayed webhook, or a new confirmation from the
 * regularisation page that moves the same attempt `FAILED → REQUIRES_ACTION` again, finds the
 * same key and sends nothing; a manual retry (VTC-041) increments `attempt` and therefore sends
 * a new link. The key is stored in `Notification.dedupeKey` (unique), never a token or a URL.
 */

const PREFIX = "payment-action-required";

export const PAYMENT_ACTION_REQUIRED_KEY_PATTERN = /^payment-action-required:([^:]+):([1-9]\d*)$/;

export class InvalidPaymentActionKeyError extends Error {
  constructor() {
    super("Invalid payment id or attempt for a payment-action-required key");
    this.name = "InvalidPaymentActionKeyError";
  }
}

function assertPaymentId(paymentId: string): void {
  if (paymentId.length === 0 || paymentId.includes(":")) throw new InvalidPaymentActionKeyError();
}

/** `payment-action-required:{paymentId}:{attempt}`; `attempt` is a positive integer. */
export function paymentActionRequiredDedupeKey(paymentId: string, attempt: number): string {
  assertPaymentId(paymentId);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new InvalidPaymentActionKeyError();
  return `${PREFIX}:${paymentId}:${attempt}`;
}

/** Common prefix of every key of one Payment, to find its latest email. */
export function paymentActionRequiredKeyPrefix(paymentId: string): string {
  assertPaymentId(paymentId);
  return `${PREFIX}:${paymentId}:`;
}

/** The attempt a key was built for, or null when the key is not one of these. */
export function attemptOfPaymentActionRequiredKey(key: string): number | null {
  const match = PAYMENT_ACTION_REQUIRED_KEY_PATTERN.exec(key);
  if (!match?.[2]) return null;
  const attempt = Number(match[2]);
  return Number.isSafeInteger(attempt) ? attempt : null;
}
