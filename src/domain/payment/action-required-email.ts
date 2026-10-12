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

/** What the back-office shows for the latest email of the current Payment. */
export type PaymentActionEmailState = "none" | "sent" | "failed" | "sending" | "interrupted";

/**
 * Display state of a notification. A `PENDING` row whose attempt started `leaseMs` ago or more
 * (or never started) is no longer being sent: the attempt was interrupted and the email is to be
 * sent again (the next call of the email service retries it). `leaseMs` is the send lease of the
 * notification service, injected: no clock and no I/O here.
 */
export function paymentActionEmailState(
  notification: Readonly<{
    status: "PENDING" | "SENT" | "FAILED";
    lastAttemptAt: Date | null;
  }> | null,
  now: Date,
  leaseMs: number,
): PaymentActionEmailState {
  if (!notification) return "none";
  switch (notification.status) {
    case "SENT":
      return "sent";
    case "FAILED":
      return "failed";
    case "PENDING":
      return notification.lastAttemptAt !== null &&
        now.getTime() - notification.lastAttemptAt.getTime() < leaseMs
        ? "sending"
        : "interrupted";
  }
}
