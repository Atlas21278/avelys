/**
 * Off-session charge at acceptance (VTC-033, docs/product/payments.md step 2, ADR-0006): pure
 * rules shared by the charge service and the webhook handlers. No I/O, no Stripe SDK: the
 * PaymentIntent is described by the plain fields the adapter extracts.
 *
 * Attempt model (V1): one Payment per booking. Every charge attempt reuses that row: `attempt`
 * is the number of the current attempt and `stripePaymentIntentId` the PaymentIntent of that
 * attempt, so `Booking.currentPaymentId` never changes.
 */

import type { BookingStatus } from "../booking/status";
import { parsePricingSnapshot } from "../pricing/snapshot";
import type { PaymentStatus } from "./status";

/**
 * Stripe idempotency key of attempt `attempt` of a booking's charge: a retried call for the same
 * attempt can never create a second PaymentIntent.
 */
export function chargeIdempotencyKey(bookingId: string, attempt: number): string {
  if (!bookingId) throw new RangeError("bookingId is required");
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }
  return `booking:${bookingId}:charge:${attempt}`;
}

/** Stripe error code of an off-session charge that needs the customer to authenticate (SCA). */
export const AUTHENTICATION_REQUIRED = "authentication_required";

/** What the charge logic needs to know about a PaymentIntent. */
export type ChargeIntentState = Readonly<{
  /** Stripe PaymentIntent status (`succeeded`, `processing`, `requires_payment_method`…). */
  status: string;
  /**
   * Error code of the failed confirmation: the card error of the synchronous call, or the
   * PaymentIntent's `last_payment_error.code` when it is read back. Null without an error.
   */
  errorCode: string | null;
  /**
   * Issuer decline code of the same error (`decline_code`), null without one. A soft decline
   * asking for authentication comes as `card_declined` with `decline_code: authentication_required`.
   */
  declineCode: string | null;
}>;

/** Whether a failed confirmation asks the customer to authenticate (either Stripe shape). */
export function requiresAuthentication(intent: ChargeIntentState): boolean {
  return (
    intent.errorCode === AUTHENTICATION_REQUIRED || intent.declineCode === AUTHENTICATION_REQUIRED
  );
}

/**
 * Payment status a PaymentIntent state leads to, or null when it decides nothing (still
 * processing, canceled, or a state this flow never produces): the Payment is then left as is.
 *
 * Off-session, Stripe does not leave a PaymentIntent in `requires_action`: the confirmation fails
 * and the PaymentIntent goes back to `requires_payment_method`, with either the error code
 * `authentication_required` or the error code `card_declined` and the decline code
 * `authentication_required` (soft decline, docs.stripe.com/declines/codes). Those codes, not the
 * status alone, tell `REQUIRES_ACTION` from `FAILED`.
 */
export function paymentStatusForIntent(intent: ChargeIntentState): PaymentStatus | null {
  switch (intent.status) {
    case "succeeded":
      return "PAID";
    case "requires_action":
      return "REQUIRES_ACTION";
    case "requires_payment_method":
      if (requiresAuthentication(intent)) return "REQUIRES_ACTION";
      // Without an error the PaymentIntent was never confirmed: nothing to decide.
      return intent.errorCode === null && intent.declineCode === null ? null : "FAILED";
    default:
      // processing (the webhook decides), canceled (VTC-041), requires_confirmation,
      // requires_capture (never produced: automatic capture, confirm: true).
      return null;
  }
}

/** Booking and current Payment as read before a charge. */
export type ChargeCandidate = Readonly<{
  booking: Readonly<{
    id: string;
    status: BookingStatus;
    currentPaymentId: string | null;
    totalTtcCents: number;
    currency: string;
    pricingSnapshot: unknown;
  }>;
  payment: Readonly<{
    id: string;
    bookingId: string;
    status: PaymentStatus;
    attempt: number;
    stripePaymentIntentId: string | null;
    amountCents: number;
    currency: string;
  }> | null;
}>;

export type ChargeRefusal = Readonly<
  | {
      /** Nothing to do (already charged, not accepted, no payment…): an idempotent no-op. */
      code: "NOT_CHARGEABLE";
      reason:
        "no_payment" | "booking_not_accepted" | "payment_not_pending" | "attempt_already_made";
    }
  | {
      /** The current Payment does not belong to this booking: never charged. */
      code: "PAYMENT_STATE_INCONSISTENT";
      reason: "payment_not_current" | "payment_of_other_booking";
    }
  | {
      /** Payment, booking and snapshot disagree on the amount: never charged (BR-12, BR-13). */
      code: "PAYMENT_AMOUNT_MISMATCH";
      reason:
        "payment_vs_booking" | "invalid_snapshot" | "snapshot_vs_booking" | "non_positive_amount";
    }
>;

export type ChargeCheck =
  | Readonly<{ ok: true; amountCents: number; currency: string }>
  | Readonly<{ ok: false; refusal: ChargeRefusal }>;

/** Payment ownership: an inconsistent pointer is never charged, whatever the statuses. */
export function checkPaymentOwnership({
  booking,
  payment,
}: ChargeCandidate): ChargeRefusal | null {
  if (payment === null || booking.currentPaymentId === null) {
    return { code: "NOT_CHARGEABLE", reason: "no_payment" };
  }
  if (booking.currentPaymentId !== payment.id) {
    return { code: "PAYMENT_STATE_INCONSISTENT", reason: "payment_not_current" };
  }
  if (payment.bookingId !== booking.id) {
    return { code: "PAYMENT_STATE_INCONSISTENT", reason: "payment_of_other_booking" };
  }
  return null;
}

/**
 * The amount to charge: the frozen one of the Payment, which must equal the booking total and
 * the validated snapshot total: never a value from the browser (BR-12), never a recomputation
 * with a newer rule (BR-13). Shared by the first attempt and the manual retry (VTC-041).
 */
export function checkChargeAmount({
  booking,
  payment,
}: Readonly<{
  booking: ChargeCandidate["booking"];
  payment: NonNullable<ChargeCandidate["payment"]>;
}>): ChargeCheck {
  const refuse = (refusal: ChargeRefusal): ChargeCheck => ({ ok: false, refusal });
  if (payment.amountCents !== booking.totalTtcCents || payment.currency !== booking.currency) {
    return refuse({ code: "PAYMENT_AMOUNT_MISMATCH", reason: "payment_vs_booking" });
  }
  let snapshotTotal: { ttcCents: number; currency: string };
  try {
    snapshotTotal = parsePricingSnapshot(booking.pricingSnapshot).totals;
  } catch {
    return refuse({ code: "PAYMENT_AMOUNT_MISMATCH", reason: "invalid_snapshot" });
  }
  if (
    snapshotTotal.ttcCents !== booking.totalTtcCents ||
    snapshotTotal.currency !== booking.currency
  ) {
    return refuse({ code: "PAYMENT_AMOUNT_MISMATCH", reason: "snapshot_vs_booking" });
  }
  if (payment.amountCents <= 0) {
    // A zero or negative total is never sent to Stripe.
    return refuse({ code: "PAYMENT_AMOUNT_MISMATCH", reason: "non_positive_amount" });
  }
  return { ok: true, amountCents: payment.amountCents, currency: payment.currency };
}

/**
 * Whether the first charge attempt may be made, and for which amount (`checkChargeAmount`).
 */
export function checkChargeable(candidate: ChargeCandidate): ChargeCheck {
  const refuse = (refusal: ChargeRefusal): ChargeCheck => ({ ok: false, refusal });
  const { booking, payment } = candidate;

  const ownership = checkPaymentOwnership(candidate);
  if (ownership) return refuse(ownership);
  if (payment === null) return refuse({ code: "NOT_CHARGEABLE", reason: "no_payment" });

  if (booking.status !== "ACCEPTED") {
    return refuse({ code: "NOT_CHARGEABLE", reason: "booking_not_accepted" });
  }
  if (payment.status !== "PENDING") {
    return refuse({ code: "NOT_CHARGEABLE", reason: "payment_not_pending" });
  }
  if (payment.attempt !== 0 || payment.stripePaymentIntentId !== null) {
    return refuse({ code: "NOT_CHARGEABLE", reason: "attempt_already_made" });
  }
  return checkChargeAmount({ booking, payment });
}
