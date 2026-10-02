/**
 * Manual retry of a failed off-session charge (VTC-041, DEC-27, docs/product/payments.md
 * "Relance manuelle"): pure rules of the back-office retry. No I/O, no Stripe SDK.
 *
 * No automatic retry and no retry limit: each retry is an explicit, confirmed and audited action
 * of an owner (ADMIN). The retry reuses the attempt model of VTC-033: same Payment row, `attempt`
 * + 1, `stripePaymentIntentId` replaced, `Booking.currentPaymentId` unchanged.
 */

import type { Role } from "../auth/access";
import type { BookingStatus } from "../booking/status";
import {
  checkChargeAmount,
  checkPaymentOwnership,
  type ChargeCandidate,
  type ChargeRefusal,
} from "./charge";
import type { PaymentStatus } from "./status";

/** Roles allowed to retry a charge: the owners only (DEC-27). Extension = docs first. */
export const CHARGE_RETRY_ROLES = ["ADMIN"] as const satisfies readonly Role[];

export function canRetryChargeAs(role: Role): boolean {
  return (CHARGE_RETRY_ROLES as readonly Role[]).includes(role);
}

/** What decides whether the retry button is offered (the server re-checks everything). */
export type ChargeRetryState = Readonly<{
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  attempt: number;
}>;

export type RetryRefusalReason =
  | "booking_not_accepted"
  /** The customer must authenticate through the regularisation link (VTC-042), not off-session. */
  | "payment_requires_action"
  /** `PENDING` before any attempt: the first charge belongs to the acceptance (VTC-033). */
  | "no_attempt_yet"
  | "payment_not_retryable";

/**
 * Whether a charge may be retried: booking `ACCEPTED` and current Payment `FAILED`, or `PENDING`
 * after a first attempt (interrupted by a technical error or a crash). Never from
 * `REQUIRES_ACTION`: an off-session retry would ask for authentication again and invalidate the
 * customer's link.
 */
export function retryRefusal(state: ChargeRetryState): RetryRefusalReason | null {
  if (state.bookingStatus !== "ACCEPTED") return "booking_not_accepted";
  if (state.paymentStatus === "FAILED") return null;
  if (state.paymentStatus === "REQUIRES_ACTION") return "payment_requires_action";
  if (state.paymentStatus === "PENDING") return state.attempt >= 1 ? null : "no_attempt_yet";
  return "payment_not_retryable";
}

export type RetryCheckRefusal = Readonly<
  | { code: "PAYMENT_NOT_RETRYABLE"; reason: RetryRefusalReason | "no_payment" }
  | Exclude<ChargeRefusal, { code: "NOT_CHARGEABLE" }>
>;

export type RetryCheck =
  | Readonly<{ ok: true; amountCents: number; currency: string }>
  | Readonly<{ ok: false; refusal: RetryCheckRefusal }>;

/**
 * Whether the charge of this booking may be retried, and for which amount. Ownership first (an
 * inconsistent pointer is never charged), then the statuses, then the frozen amount (BR-12/13).
 */
export function checkRetryable(candidate: ChargeCandidate): RetryCheck {
  const ownership = checkPaymentOwnership(candidate);
  if (ownership) {
    return ownership.code === "NOT_CHARGEABLE"
      ? { ok: false, refusal: { code: "PAYMENT_NOT_RETRYABLE", reason: "no_payment" } }
      : { ok: false, refusal: ownership };
  }
  const { booking, payment } = candidate;
  if (payment === null) {
    return { ok: false, refusal: { code: "PAYMENT_NOT_RETRYABLE", reason: "no_payment" } };
  }
  const reason = retryRefusal({
    bookingStatus: booking.status,
    paymentStatus: payment.status,
    attempt: payment.attempt,
  });
  if (reason) return { ok: false, refusal: { code: "PAYMENT_NOT_RETRYABLE", reason } };

  const amount = checkChargeAmount({ booking, payment });
  if (amount.ok) return amount;
  // checkChargeAmount only refuses with PAYMENT_AMOUNT_MISMATCH.
  return amount.refusal.code === "PAYMENT_AMOUNT_MISMATCH"
    ? { ok: false, refusal: amount.refusal }
    : { ok: false, refusal: { code: "PAYMENT_NOT_RETRYABLE", reason: "payment_not_retryable" } };
}

/** PaymentIntent statuses that may still be confirmed: cancelled before any new attempt. */
export const CANCELABLE_INTENT_STATUSES = [
  "requires_payment_method",
  "requires_action",
  "requires_confirmation",
] as const;

/** A PaymentIntent as the retry plan sees it. */
export type RetryIntent = Readonly<{ id: string; status: string; attempt: number | null }>;

export type RetryPlan<T extends RetryIntent> = Readonly<
  | {
      /** Money already taken: reconcile, never charge again. */
      kind: "reconcile";
      intent: T;
    }
  | {
      /**
       * Stripe has not settled a PaymentIntent yet (`processing`), or it is in a state this flow
       * never produces (`requires_capture`, unknown): no new attempt.
       */
      kind: "in_progress";
    }
  | {
      /** New attempt allowed once every still-open PaymentIntent is cancelled. */
      kind: "charge";
      toCancel: readonly T[];
    }
>;

/**
 * Decision taken from the PaymentIntents of the booking's dedicated Stripe Customer, read before
 * any new attempt (DEC-27): a `succeeded` one wins (reconciliation without a charge), then any
 * unsettled one blocks; otherwise the still-open ones are cancelled and a new attempt is made.
 * `canceled` PaymentIntents are terminal and ignored. Fails closed on an unknown status.
 */
export function planChargeRetry<T extends RetryIntent>(intents: readonly T[]): RetryPlan<T> {
  const succeeded = intents.find((intent) => intent.status === "succeeded");
  if (succeeded) return { kind: "reconcile", intent: succeeded };

  const toCancel: T[] = [];
  for (const intent of intents) {
    if (intent.status === "canceled") continue;
    if ((CANCELABLE_INTENT_STATUSES as readonly string[]).includes(intent.status)) {
      toCancel.push(intent);
      continue;
    }
    return { kind: "in_progress" };
  }
  return { kind: "charge", toCancel };
}

/**
 * Stripe idempotency key of the cancellation of a booking's PaymentIntent: one per attempt (from
 * the PaymentIntent metadata), or per PaymentIntent id for one created without our metadata.
 * Each cancellation request is distinct, so two open PaymentIntents never share a key.
 */
export function cancelIdempotencyKey(bookingId: string, intent: RetryIntent): string {
  if (!bookingId) throw new RangeError("bookingId is required");
  const suffix = intent.attempt !== null && intent.attempt >= 1 ? intent.attempt : intent.id;
  return `booking:${bookingId}:cancel:${suffix}`;
}
