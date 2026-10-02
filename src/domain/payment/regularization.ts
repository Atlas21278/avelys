/**
 * SCA regularisation (VTC-042, DEC-27, docs/product/payments.md "Régularisation SCA"): pure
 * rules deciding whether a signed link may be used and what the customer's page offers. No I/O,
 * no clock: `now` is injected.
 *
 * The page never writes a status: `PAID`/`CONFIRMED` or `FAILED` come from the webhooks of
 * VTC-033 (BR-41). These rules only decide what to show.
 */

import type { BookingStatus } from "../booking/status";
import { requiresAuthentication, type ChargeIntentState } from "./charge";
import type { PaymentStatus } from "./status";

/** Payment and booking as read for a link, the Payment found by the id of the token. */
export type RegularizationCandidate = Readonly<{
  claim: Readonly<{ paymentId: string; attempt: number }>;
  payment: Readonly<{
    id: string;
    bookingId: string;
    status: PaymentStatus;
    attempt: number;
    stripePaymentIntentId: string | null;
  }> | null;
  booking: Readonly<{
    id: string;
    status: BookingStatus;
    currentPaymentId: string | null;
    pickupAt: Date;
  }> | null;
}>;

/**
 * Whether a link signed for `claim` is usable now: the Payment exists, is its booking's current
 * Payment, is at the same attempt, waits for the customer (`REQUIRES_ACTION`) with a
 * PaymentIntent, and the booking is `ACCEPTED` with its pickup still ahead. No duration is
 * invented: an absolute deadline will come with DEC-13. The reason of a refusal is never shown.
 */
export function isRegularizationLinkUsable(candidate: RegularizationCandidate, now: Date): boolean {
  const { claim, payment, booking } = candidate;
  if (!payment || !booking) return false;
  return (
    payment.id === claim.paymentId &&
    payment.bookingId === booking.id &&
    booking.currentPaymentId === payment.id &&
    payment.attempt === claim.attempt &&
    payment.status === "REQUIRES_ACTION" &&
    payment.stripePaymentIntentId !== null &&
    booking.status === "ACCEPTED" &&
    booking.pickupAt.getTime() > now.getTime()
  );
}

/**
 * What the page offers for the PaymentIntent of the current attempt, read back from Stripe:
 *
 * - `confirm`: the off-session confirmation failed for authentication (`requires_payment_method`
 *   with `authentication_required`, either Stripe shape) or waits for a confirmation: Stripe.js
 *   confirms the same PaymentIntent with the saved payment method, on session;
 * - `next_action`: the PaymentIntent waits for an authentication step (`requires_action`):
 *   Stripe.js runs it;
 * - `settled`: paid or being processed, the webhook will confirm;
 * - `closed`: anything else (declined, canceled…): cannot be finished online.
 */
export type RegularizationStep = "confirm" | "next_action" | "settled" | "closed";

export function regularizationStep(intent: ChargeIntentState): RegularizationStep {
  switch (intent.status) {
    case "succeeded":
    case "processing":
      return "settled";
    case "requires_action":
      return "next_action";
    case "requires_confirmation":
      return "confirm";
    case "requires_payment_method":
      return requiresAuthentication(intent) ? "confirm" : "closed";
    default:
      return "closed";
  }
}
