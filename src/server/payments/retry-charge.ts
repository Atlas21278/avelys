import "server-only";

import Stripe from "stripe";

import type { Role } from "@/domain/auth/access";
import type { BookingStatus } from "@/domain/booking/status";
import { chargeIdempotencyKey } from "@/domain/payment/charge";
import {
  cancelIdempotencyKey,
  canRetryChargeAs,
  checkRetryable,
  planChargeRetry,
  type RetryCheckRefusal,
} from "@/domain/payment/retry";
import type { PaymentStatus } from "@/domain/payment/status";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  PaymentIntentError,
  StripeConfigError,
  type OffSessionChargeResult,
  type PaymentIntentGateway,
  type PaymentIntentSummary,
} from "@/integrations/stripe";
import { logger } from "@/lib/logger";
import type { Currency } from "@/lib/money";
import { currentCorrelationId } from "@/lib/request-context";
import { writeAuditLog } from "@/server/audit/audit-log";
import { db } from "@/server/db";

import { runRequiresActionPort, type OnPaymentRequiresAction } from "./after-charge";
import { applyChargeResult } from "./apply-charge";

/**
 * Manual retry of a failed off-session charge by an owner (VTC-041, DEC-27,
 * docs/product/payments.md "Relance manuelle"). Same attempt model as the first charge (VTC-033):
 * same Payment row, `attempt` + 1, `stripePaymentIntentId` replaced, `currentPaymentId`
 * unchanged, Payment transition table unchanged.
 *
 * 1. checks: ADMIN, booking `ACCEPTED`, current Payment `FAILED` or `PENDING` after an attempt
 *    (never `REQUIRES_ACTION`), ownership, frozen amount, displayed Payment version;
 * 2. reads the PaymentIntents of the booking's dedicated Stripe Customer before any new attempt:
 *    a `succeeded` one is reconciled without charging; a `processing` one refuses the retry; the
 *    still-open ones are cancelled (a cancellation refused because it succeeded meanwhile is read
 *    back and reconciled). A Stripe failure here writes nothing;
 * 3. reserves the attempt under the optimistic lock of the displayed version, with its AuditLog
 *    row (actor ADMIN, previous `pi_…`): of two concurrent retries only one goes on;
 * 4. creates the new PaymentIntent (key `booking:{id}:charge:{attempt}`) and applies its outcome
 *    with the service of the first charge (`applyChargeResult`).
 *
 * No automatic retry and no retry limit (DEC-27): each retry is an explicit, confirmed, audited
 * action. Logs carry the booking reference, attempts, statuses and error names only.
 */

export interface RetryChargeActor {
  readonly role: Role;
  /** Staff user id, recorded as the AuditLog actor. */
  readonly userId: string;
}

export interface RetryChargeDeps {
  readonly db?: PrismaClient;
  /** Resolved on use: a missing or live key is a technical failure. */
  readonly gateway: () => PaymentIntentGateway;
  readonly onPaymentRequiresAction?: OnPaymentRequiresAction;
}

export type ChargeRetryErrorCode =
  | "ACCESS_DENIED"
  | "BOOKING_NOT_FOUND"
  | RetryCheckRefusal["code"]
  | "PAYMENT_IN_PROGRESS"
  | "PAYMENT_CONCURRENT_UPDATE"
  /** Stripe could not be read or a PaymentIntent cancelled: nothing was written. */
  | "PAYMENT_UNAVAILABLE"
  /** The attempt was reserved (audited) but Stripe gave no outcome: retry later. */
  | "PAYMENT_ATTEMPT_INTERRUPTED";

/** A refused or interrupted retry. Carries a code and a reason, never an id or personal data. */
export class ChargeRetryError extends Error {
  override readonly name = "ChargeRetryError";

  constructor(
    readonly code: ChargeRetryErrorCode,
    readonly reason: string,
  ) {
    super(`Charge retry not done: ${code} (${reason})`);
  }
}

export type ChargeRetryOutcome = Readonly<{
  /** `reconciled`: a payment Stripe already had was recorded, nothing was charged. */
  outcome: "reconciled" | "charged";
  reference: string;
  attempt: number;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
}>;

function isTechnicalStripeFailure(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError ||
    error instanceof StripeConfigError ||
    error instanceof PaymentIntentError
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

type Resolution =
  | Readonly<{ kind: "reconcile"; intent: PaymentIntentSummary }>
  | Readonly<{ kind: "in_progress" }>
  | Readonly<{ kind: "charge" }>;

/**
 * Step 2: what Stripe says before any new attempt. Every still-open PaymentIntent is cancelled
 * first, so that none of them can be confirmed in parallel (not even through a customer link).
 */
async function resolveWithStripe(
  gateway: PaymentIntentGateway,
  bookingId: string,
  customerId: string,
): Promise<Resolution> {
  const plan = planChargeRetry(await gateway.listCustomerPaymentIntents(customerId));
  if (plan.kind !== "charge") return plan;

  for (const intent of plan.toCancel) {
    try {
      await gateway.cancelPaymentIntent(intent.id, cancelIdempotencyKey(bookingId, intent));
    } catch (error) {
      if (!isTechnicalStripeFailure(error)) throw error;
      // Refused or failed: read it back. It may have succeeded (or been cancelled) meanwhile.
      const current = await gateway.retrievePaymentIntent(intent.id);
      if (current?.status === "canceled") continue;
      if (current?.status === "succeeded") return { kind: "reconcile", intent: current };
      if (current?.status === "processing") return { kind: "in_progress" };
      throw error;
    }
  }
  return { kind: "charge" };
}

export async function retryBookingCharge(
  reference: string,
  expectedPaymentVersion: number,
  actor: RetryChargeActor,
  deps: RetryChargeDeps,
): Promise<ChargeRetryOutcome> {
  const client = deps.db ?? db();
  const log = logger();
  const refuse = (code: ChargeRetryErrorCode, reason: string): never => {
    throw new ChargeRetryError(code, reason);
  };

  // Defence in depth: the action body already checked the session role.
  if (!canRetryChargeAs(actor.role)) refuse("ACCESS_DENIED", "role");

  // 1. Booking, current Payment and checks.
  const booking = await client.booking.findUnique({
    where: { reference },
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
  if (!booking) return refuse("BOOKING_NOT_FOUND", "booking_not_found");
  const bookingRef = booking.reference;
  const payment = booking.currentPayment;

  const check = checkRetryable({ booking, payment });
  if (!check.ok) {
    const { code, reason } = check.refusal;
    if (code === "PAYMENT_NOT_RETRYABLE") log.info({ bookingRef, code, reason }, "retry refused");
    else log.error({ bookingRef, code, reason }, "retry refused");
    return refuse(code, reason);
  }
  // checkRetryable returns ok only with a payment.
  if (!payment) throw new Error("unreachable: retryable without payment");
  if (payment.version !== expectedPaymentVersion) {
    log.info({ bookingRef, reason: "stale_version" }, "retry refused");
    refuse("PAYMENT_CONCURRENT_UPDATE", "stale_version");
  }

  // 2. Stripe before any new attempt (outside any transaction).
  let gateway: PaymentIntentGateway;
  let resolution: Resolution;
  try {
    gateway = deps.gateway();
    resolution = await resolveWithStripe(gateway, booking.id, payment.stripeCustomerId);
  } catch (error) {
    if (!isTechnicalStripeFailure(error)) throw error;
    log.error(
      { bookingRef, attempt: payment.attempt, errorName: errorName(error) },
      "retry not started: Stripe could not be checked; nothing was written",
    );
    return refuse("PAYMENT_UNAVAILABLE", "stripe_check_failed");
  }

  if (resolution.kind === "in_progress") {
    log.info({ bookingRef, attempt: payment.attempt }, "retry refused: payment in progress");
    return refuse("PAYMENT_IN_PROGRESS", "processing");
  }

  if (resolution.kind === "reconcile") {
    const { intent } = resolution;
    const applied = await client.$transaction((tx) =>
      applyChargeResult(tx, {
        paymentId: payment.id,
        intent,
        errorCode: intent.lastPaymentErrorCode,
        declineCode: intent.lastPaymentErrorDeclineCode,
      }),
    );
    if (applied.outcome === "ignored") {
      // Money taken at Stripe that the Payment cannot be matched with: never charge again;
      // the owners check it by hand (refund policy DEC-05).
      log.error(
        {
          bookingRef,
          attempt: payment.attempt,
          paymentIntentAttempt: intent.attempt,
          reason: applied.reason,
          alert: "unmatched_succeeded_payment_intent",
        },
        "retry refused: a succeeded PaymentIntent exists but cannot be reconciled",
      );
      return refuse("PAYMENT_STATE_INCONSISTENT", applied.reason);
    }
    log.info(
      {
        bookingRef,
        attempt: payment.attempt,
        paymentStatus: applied.paymentStatus,
        bookingStatus: applied.bookingStatus,
      },
      "retry: payment already received, reconciled without a new charge",
    );
    return {
      outcome: "reconciled",
      reference: bookingRef,
      attempt: payment.attempt,
      paymentStatus: applied.paymentStatus,
      bookingStatus: applied.bookingStatus,
    };
  }

  // 3. Reserve the attempt under the optimistic lock of the displayed version.
  const nextAttempt = payment.attempt + 1;
  const reserved = await client.$transaction(async (tx) => {
    const stillAccepted = await tx.booking.count({
      where: { id: booking.id, status: "ACCEPTED", currentPaymentId: payment.id },
    });
    if (stillAccepted !== 1) return false;
    const updated = await tx.payment.updateMany({
      where: {
        id: payment.id,
        version: expectedPaymentVersion,
        status: payment.status,
        attempt: payment.attempt,
      },
      // The previous PaymentIntent is forgotten by the row (kept in the AuditLog): its late
      // webhooks then match no current attempt and are ignored (VTC-033 handlers).
      data: { attempt: nextAttempt, stripePaymentIntentId: null, version: { increment: 1 } },
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
      action: "payment.retry",
      actorType: actor.role,
      actorId: actor.userId,
      entityId: payment.id,
      before: {
        ...state,
        version: payment.version,
        attempt: payment.attempt,
        ...(payment.stripePaymentIntentId ? { paymentIntentId: payment.stripePaymentIntentId } : {}),
      },
      after: { ...state, version: payment.version + 1, attempt: nextAttempt },
      correlationId: currentCorrelationId() ?? null,
    });
    return true;
  });
  if (!reserved) {
    log.info({ bookingRef, reason: "concurrent_update" }, "retry refused");
    return refuse("PAYMENT_CONCURRENT_UPDATE", "concurrent_update");
  }

  // 4. New PaymentIntent, then its outcome through the service of the first charge.
  let result: OffSessionChargeResult;
  try {
    result = await gateway.createOffSessionCharge({
      customerId: payment.stripeCustomerId,
      paymentMethodId: payment.stripePaymentMethodId,
      amountCents: check.amountCents,
      currency: check.currency,
      bookingRef,
      attempt: nextAttempt,
      idempotencyKey: chargeIdempotencyKey(booking.id, nextAttempt),
    });
  } catch (error) {
    if (!isTechnicalStripeFailure(error)) throw error;
    log.error(
      { bookingRef, attempt: nextAttempt, errorName: errorName(error) },
      "retry interrupted before an outcome; the next retry checks Stripe first",
    );
    return refuse("PAYMENT_ATTEMPT_INTERRUPTED", "stripe_charge_failed");
  }

  const applied = await client.$transaction((tx) =>
    applyChargeResult(tx, {
      paymentId: payment.id,
      intent: result.intent,
      errorCode: result.errorCode,
      declineCode: result.declineCode,
    }),
  );
  if (applied.outcome === "ignored") {
    log.error(
      { bookingRef, attempt: nextAttempt, reason: applied.reason },
      "retry outcome not applied",
    );
    return refuse("PAYMENT_STATE_INCONSISTENT", applied.reason);
  }
  log.info(
    {
      bookingRef,
      attempt: nextAttempt,
      outcome: applied.outcome,
      paymentStatus: applied.paymentStatus,
      bookingStatus: applied.bookingStatus,
      errorCode: result.errorCode,
      declineCode: result.declineCode,
      actor: actor.role,
    },
    "booking charge retried",
  );
  if (applied.enteredRequiresAction) {
    await runRequiresActionPort(deps.onPaymentRequiresAction, payment.id, bookingRef);
  }
  return {
    outcome: "charged",
    reference: bookingRef,
    attempt: nextAttempt,
    paymentStatus: applied.paymentStatus,
    bookingStatus: applied.bookingStatus,
  };
}
