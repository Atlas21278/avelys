import "server-only";

import Stripe from "stripe";

import { chargeIdempotencyKey, checkChargeable, type ChargeRefusal } from "@/domain/payment/charge";
import type { PaymentStatus } from "@/domain/payment/status";
import type { BookingStatus } from "@/domain/booking/status";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  PaymentIntentError,
  StripeConfigError,
  type OffSessionChargeResult,
  type PaymentIntentGateway,
} from "@/integrations/stripe";
import { logger } from "@/lib/logger";
import type { Currency } from "@/lib/money";
import { currentCorrelationId } from "@/lib/request-context";
import { writeAuditLog } from "@/server/audit/audit-log";
import { db } from "@/server/db";

import { runRequiresActionPort, type OnPaymentRequiresAction } from "./after-charge";
import { applyChargeResult } from "./apply-charge";

/**
 * Off-session charge at acceptance (VTC-033, docs/product/payments.md step 2, ADR-0006, DEC-27).
 * Implements the post-commit port `onBookingAccepted` of the booking decision:
 *
 * 1. reads the booking and its current Payment; anything but an `ACCEPTED` booking with an
 *    untouched `PENDING` Payment is an idempotent no-op (a second call never charges twice);
 * 2. checks ownership and the amount (Payment = Booking = validated snapshot total, BR-12/13);
 * 3. reserves the attempt: `attempt` 0 → 1 under an optimistic lock, with its AuditLog row, so
 *    that of two concurrent calls only one goes on;
 * 4. lists the PaymentIntents of the booking's dedicated Stripe Customer: a `succeeded` or
 *    `processing` one is applied instead of charging again;
 * 5. creates the off-session PaymentIntent (idempotency key `booking:{id}:charge:{attempt}`,
 *    metadata `bookingRef` + `attempt` only), outside any transaction;
 * 6. applies the outcome (`applyChargeResult`), then calls `onPaymentRequiresAction` after commit.
 *
 * A technical Stripe failure leaves the Payment `PENDING` with `attempt = 1` and the booking
 * `ACCEPTED`: the manual retry (VTC-041) checks Stripe before any new attempt. No automatic
 * retry (DEC-27). Logs carry the booking reference, statuses and error names only.
 */

export interface ChargeBookingDeps {
  readonly db?: PrismaClient;
  /** Resolved on use: a missing or live key is a technical failure (no transition). */
  readonly gateway: () => PaymentIntentGateway;
  readonly onPaymentRequiresAction?: OnPaymentRequiresAction;
}

export type ChargeBookingOutcome = Readonly<
  | {
      outcome: "skipped";
      reason: "booking_not_found" | "attempt_in_progress" | ChargeRefusal["reason"];
    }
  | { outcome: "refused"; code: Exclude<ChargeRefusal["code"], "NOT_CHARGEABLE">; reason: string }
  | { outcome: "technical_error"; errorName: string }
  | { outcome: "ignored"; reason: string }
  | { outcome: "applied" | "unchanged"; paymentStatus: PaymentStatus; bookingStatus: BookingStatus }
>;

const FIRST_ATTEMPT = 1;

function isTechnicalStripeFailure(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError ||
    error instanceof StripeConfigError ||
    error instanceof PaymentIntentError
  );
}

export async function chargeBooking(
  bookingId: string,
  deps: ChargeBookingDeps,
): Promise<ChargeBookingOutcome> {
  const client = deps.db ?? db();
  const log = logger();

  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      status: true,
      currentPaymentId: true,
      totalTtcCents: true,
      currency: true,
      pricingSnapshot: true,
      currentPayment: {
        select: {
          id: true,
          bookingId: true,
          status: true,
          attempt: true,
          version: true,
          stripePaymentIntentId: true,
          stripeCustomerId: true,
          stripePaymentMethodId: true,
          amountCents: true,
          currency: true,
        },
      },
    },
  });
  if (!booking) {
    log.warn("charge skipped: booking not found");
    return { outcome: "skipped", reason: "booking_not_found" };
  }
  const bookingRef = booking.reference;
  const payment = booking.currentPayment;

  const check = checkChargeable({ booking, payment });
  if (!check.ok) {
    const { code, reason } = check.refusal;
    if (code === "NOT_CHARGEABLE") {
      log.info({ bookingRef, reason }, "charge skipped");
      return { outcome: "skipped", reason };
    }
    log.error({ bookingRef, code, reason }, "charge refused");
    return { outcome: "refused", code, reason };
  }
  // checkChargeable returns ok only with a payment.
  if (!payment) throw new Error("unreachable: chargeable without payment");

  // 3. Reserve the attempt: of two concurrent calls, only one moves attempt 0 → 1.
  const reserved = await client.$transaction(async (tx) => {
    const stillAccepted = await tx.booking.count({
      where: { id: booking.id, status: "ACCEPTED", currentPaymentId: payment.id },
    });
    if (stillAccepted !== 1) return false;
    const updated = await tx.payment.updateMany({
      where: {
        id: payment.id,
        version: payment.version,
        attempt: 0,
        status: "PENDING",
        stripePaymentIntentId: null,
      },
      data: { attempt: FIRST_ATTEMPT, version: { increment: 1 } },
    });
    if (updated.count !== 1) return false;
    const state = {
      bookingRef,
      status: payment.status,
      amountCents: payment.amountCents,
      // Checked at runtime by the audit whitelist (ISO 4217 codes of CURRENCIES).
      currency: payment.currency as Currency,
    };
    await writeAuditLog(tx, {
      action: "payment.charge_attempt",
      actorType: "SYSTEM",
      actorId: null,
      entityId: payment.id,
      before: { ...state, version: payment.version, attempt: 0 },
      after: { ...state, version: payment.version + 1, attempt: FIRST_ATTEMPT },
      correlationId: currentCorrelationId() ?? null,
    });
    return true;
  });
  if (!reserved) {
    log.info({ bookingRef, reason: "attempt_in_progress" }, "charge skipped");
    return { outcome: "skipped", reason: "attempt_in_progress" };
  }

  // 4-5. Stripe, outside any transaction.
  let result: OffSessionChargeResult;
  try {
    const gateway = deps.gateway();
    const existing = await gateway.listCustomerPaymentIntents(payment.stripeCustomerId);
    const settled =
      existing.find((intent) => intent.status === "succeeded") ??
      existing.find((intent) => intent.status === "processing");
    if (settled) {
      log.warn(
        { bookingRef, attempt: FIRST_ATTEMPT, stripeStatus: settled.status },
        "charge not sent: a PaymentIntent already exists for this booking",
      );
      result = {
        intent: settled,
        errorCode: settled.lastPaymentErrorCode,
        declineCode: settled.lastPaymentErrorDeclineCode,
      };
    } else {
      result = await gateway.createOffSessionCharge({
        customerId: payment.stripeCustomerId,
        paymentMethodId: payment.stripePaymentMethodId,
        amountCents: check.amountCents,
        currency: check.currency,
        bookingRef,
        attempt: FIRST_ATTEMPT,
        idempotencyKey: chargeIdempotencyKey(booking.id, FIRST_ATTEMPT),
      });
    }
  } catch (error) {
    if (!isTechnicalStripeFailure(error)) throw error;
    const errorName = error instanceof Error ? error.name : "unknown";
    log.error(
      { bookingRef, attempt: FIRST_ATTEMPT, errorName },
      "charge failed before an outcome; the payment stays PENDING and the booking ACCEPTED",
    );
    return { outcome: "technical_error", errorName };
  }

  // 6. Apply the outcome (a webhook may have applied it already: same rules, no double effect).
  const applied = await client.$transaction((tx) =>
    applyChargeResult(tx, {
      paymentId: payment.id,
      intent: result.intent,
      errorCode: result.errorCode,
      declineCode: result.declineCode,
    }),
  );
  if (applied.outcome === "ignored") {
    log.error({ bookingRef, reason: applied.reason }, "charge outcome not applied");
    return { outcome: "ignored", reason: applied.reason };
  }
  log.info(
    {
      bookingRef,
      attempt: FIRST_ATTEMPT,
      outcome: applied.outcome,
      paymentStatus: applied.paymentStatus,
      bookingStatus: applied.bookingStatus,
      errorCode: result.errorCode,
      declineCode: result.declineCode,
    },
    "booking charge processed",
  );

  if (applied.enteredRequiresAction) {
    await runRequiresActionPort(deps.onPaymentRequiresAction, payment.id, bookingRef);
  }
  return {
    outcome: applied.outcome,
    paymentStatus: applied.paymentStatus,
    bookingStatus: applied.bookingStatus,
  };
}
