import "server-only";

import type { BookingStatus } from "@/domain/booking/status";
import { assertTransition } from "@/domain/booking/transitions";
import { paymentStatusForIntent } from "@/domain/payment/charge";
import type { PaymentStatus } from "@/domain/payment/status";
import { canTransitionPayment } from "@/domain/payment/transitions";
import type { Prisma } from "@/generated/prisma/client";
import type { PaymentIntentSummary } from "@/integrations/stripe";
import { logger } from "@/lib/logger";
import type { Currency } from "@/lib/money";
import { currentCorrelationId } from "@/lib/request-context";
import { writeAuditLog } from "@/server/audit/audit-log";

/**
 * Applies the outcome of a charge attempt to the Payment and, on success, to the Booking
 * (VTC-033). Shared by the synchronous charge and the webhook handlers, so that both apply the
 * same rules whatever the order they arrive in:
 *
 * - the Payment row, then its Booking, are locked (`FOR UPDATE`): a webhook and the synchronous
 *   answer for the same attempt are applied one after the other, never interleaved;
 * - the target status comes from `paymentStatusForIntent` (current Stripe state), checked against
 *   the central Payment transition table; a change the table does not list is ignored, and the
 *   same status twice is not a transition (no write, so a replay has no effect);
 * - `PAID` confirms the booking `ACCEPTED → CONFIRMED` as SYSTEM through the Booking table;
 * - every write bumps `version` under an optimistic lock and writes its AuditLog row.
 *
 * Runs inside the caller's transaction; no network call here. Logs carry the booking reference
 * and statuses only, never a Stripe id (BR-60).
 */

export type ChargeApplicationInput = Readonly<{
  paymentId: string;
  intent: PaymentIntentSummary;
  /** Error code of the attempt (card error or `last_payment_error.code`), null without one. */
  errorCode: string | null;
  /** Issuer decline code of the same error (card error or `last_payment_error.decline_code`). */
  declineCode: string | null;
}>;

export type ChargeApplication = Readonly<
  | {
      outcome: "applied" | "unchanged";
      bookingRef: string;
      paymentStatus: PaymentStatus;
      bookingStatus: BookingStatus;
      /** True when this call moved the Payment into `REQUIRES_ACTION`. */
      enteredRequiresAction: boolean;
    }
  | {
      outcome: "ignored";
      bookingRef: string | null;
      reason:
        | "payment_not_found"
        | "payment_not_current"
        | "other_payment_intent"
        | "attempt_mismatch"
        | "customer_mismatch"
        | "amount_mismatch"
        | "live_payment_intent"
        | "transition_not_allowed";
    }
>;

/** The locked rows changed under a lock: never expected, rolls the transaction back. */
export class ChargeApplicationConflictError extends Error {
  override readonly name = "ChargeApplicationConflictError";
}

export async function applyChargeResult(
  tx: Prisma.TransactionClient,
  { paymentId, intent, errorCode, declineCode }: ChargeApplicationInput,
): Promise<ChargeApplication> {
  await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      bookingId: true,
      status: true,
      attempt: true,
      version: true,
      amountCents: true,
      currency: true,
      stripeCustomerId: true,
      stripePaymentIntentId: true,
    },
  });
  if (!payment) return { outcome: "ignored", bookingRef: null, reason: "payment_not_found" };

  await tx.$queryRaw`SELECT 1 FROM "Booking" WHERE "id" = ${payment.bookingId} FOR UPDATE`;
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: payment.bookingId },
    select: { id: true, reference: true, status: true, version: true, currentPaymentId: true },
  });
  const bookingRef = booking.reference;
  const ignore = (
    reason: Extract<ChargeApplication, { outcome: "ignored" }>["reason"],
  ): ChargeApplication => ({ outcome: "ignored", bookingRef, reason });

  // Ownership: only the booking's current Payment is ever changed (review of avelys#27).
  if (booking.currentPaymentId !== payment.id) return ignore("payment_not_current");
  if (intent.livemode) return ignore("live_payment_intent");
  if (payment.stripePaymentIntentId !== null && payment.stripePaymentIntentId !== intent.id) {
    return ignore("other_payment_intent");
  }
  const bindsIntent = payment.stripePaymentIntentId === null;
  // A PaymentIntent is bound only to the attempt that created it, re-checked under the lock: a
  // concurrent retry (VTC-041) may have moved `attempt` since the caller matched it.
  if (bindsIntent && intent.attempt !== payment.attempt) return ignore("attempt_mismatch");
  if (intent.customerId !== payment.stripeCustomerId) return ignore("customer_mismatch");
  if (intent.amountCents !== payment.amountCents || intent.currency !== payment.currency) {
    return ignore("amount_mismatch");
  }

  const from = payment.status;
  const target = paymentStatusForIntent({ status: intent.status, errorCode, declineCode });
  const changesStatus = target !== null && target !== from;
  if (changesStatus && !canTransitionPayment(from, target)) return ignore("transition_not_allowed");

  if (!changesStatus && !bindsIntent) {
    return {
      outcome: "unchanged",
      bookingRef,
      paymentStatus: from,
      bookingStatus: booking.status,
      enteredRequiresAction: false,
    };
  }

  const to: PaymentStatus = changesStatus ? target : from;
  const correlationId = currentCorrelationId() ?? null;
  const updated = await tx.payment.updateMany({
    where: { id: payment.id, version: payment.version, status: from },
    data: { status: to, stripePaymentIntentId: intent.id, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new ChargeApplicationConflictError("Payment changed under lock");

  const paymentState = {
    bookingRef,
    amountCents: payment.amountCents,
    // Checked at runtime by the audit whitelist (ISO 4217 codes of CURRENCIES).
    currency: payment.currency as Currency,
    attempt: payment.attempt,
  };
  await writeAuditLog(tx, {
    action: "payment.charge",
    actorType: "SYSTEM",
    actorId: null,
    entityId: payment.id,
    before: { ...paymentState, status: from, version: payment.version },
    after: {
      ...paymentState,
      status: to,
      version: payment.version + 1,
      paymentIntentId: intent.id,
    },
    correlationId,
  });

  let bookingStatus: BookingStatus = booking.status;
  if (changesStatus && to === "PAID") {
    if (booking.status === "ACCEPTED") {
      assertTransition(booking.status, "CONFIRMED", "SYSTEM");
      const confirmed = await tx.booking.updateMany({
        where: { id: booking.id, version: booking.version, status: booking.status },
        data: { status: "CONFIRMED", version: { increment: 1 } },
      });
      if (confirmed.count !== 1) {
        throw new ChargeApplicationConflictError("Booking changed under lock");
      }
      await writeAuditLog(tx, {
        action: "booking.confirm",
        actorType: "SYSTEM",
        actorId: null,
        entityId: booking.id,
        before: { bookingRef, status: booking.status, version: booking.version },
        after: { bookingRef, status: "CONFIRMED", version: booking.version + 1 },
        correlationId,
      });
      bookingStatus = "CONFIRMED";
    } else {
      // Money was taken but the booking left ACCEPTED meanwhile: the Payment still records the
      // PSP state (BR-41); the owners handle it by hand (refund policy DEC-05).
      logger().error(
        { bookingRef, bookingStatus: booking.status },
        "payment succeeded for a booking that is no longer ACCEPTED",
      );
    }
  }

  return {
    outcome: "applied",
    bookingRef,
    paymentStatus: to,
    bookingStatus,
    enteredRequiresAction: changesStatus && to === "REQUIRES_ACTION",
  };
}
