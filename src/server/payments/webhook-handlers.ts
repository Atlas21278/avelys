import "server-only";

import type Stripe from "stripe";

import type { Prisma } from "@/generated/prisma/client";
import {
  PAYMENT_INTENT_ID,
  stripePaymentIntents,
  type PaymentIntentGateway,
  type PaymentIntentSummary,
} from "@/integrations/stripe";
import { logger } from "@/lib/logger";

import { runRequiresActionPort, type OnPaymentRequiresAction } from "./after-charge";
import { applyChargeResult } from "./apply-charge";

/**
 * Registry of Stripe webhook handlers (VTC-030): event type → handler.
 *
 * A handler runs inside the transaction that records the event id: it writes through `tx` only,
 * so that a failure rolls back both and Stripe's retry is processed again. Network calls never
 * run in that transaction: a handler that needs Stripe (VTC-033) is an object whose `prepare`
 * runs first, outside it, and returns the transactional step. External effects (email) are
 * returned as an after-commit effect, run once the transaction has committed (BR-50): their
 * failure is logged and never fails the webhook.
 * Stripe status and Booking status stay separate (BR-41): a handler updates Payment, and the
 * Booking only through the central transition table.
 */
export type StripeWebhookAfterCommit = () => Promise<void>;

export type StripeWebhookTransactionStep = (
  tx: Prisma.TransactionClient,
) => Promise<StripeWebhookAfterCommit | void>;

type EventOf<T extends Stripe.Event["type"]> = Extract<Stripe.Event, { type: T }>;

export type StripeWebhookHandler<T extends Stripe.Event["type"] = Stripe.Event["type"]> =
  | ((event: EventOf<T>, tx: Prisma.TransactionClient) => Promise<StripeWebhookAfterCommit | void>)
  | {
      /** Outside the transaction (Stripe reads allowed); a failure answers 500, Stripe retries. */
      readonly prepare: (event: EventOf<T>) => Promise<StripeWebhookTransactionStep>;
    };

export type StripeWebhookHandlers = {
  readonly [T in Stripe.Event["type"]]?: StripeWebhookHandler<T>;
};

/** PaymentIntent events that carry a charge outcome (VTC-033). */
export const PAYMENT_INTENT_OUTCOME_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.requires_action",
] as const;

export interface PaymentIntentWebhookDeps {
  readonly gateway: () => PaymentIntentGateway;
  readonly onPaymentRequiresAction?: OnPaymentRequiresAction;
}

/**
 * Charge outcome events (VTC-033). The PaymentIntent is read back from Stripe before the
 * transaction and its current state applied, never the event snapshot: events may arrive in
 * any order. Matching: by `Payment.stripePaymentIntentId`, else (crash between the creation of
 * the PaymentIntent and the recording of its outcome) by `metadata.bookingRef` + the current
 * `attempt` + the same Customer. A PaymentIntent of an earlier attempt is ignored; a success on
 * one is logged as an error for a manual refund (DEC-05). No match: ignored, 200.
 * `payment_intent.canceled` has no handler: recorded without effect (cancellations: VTC-041).
 */
export function createPaymentIntentWebhookHandlers(
  deps: PaymentIntentWebhookDeps,
): StripeWebhookHandlers {
  const handler: StripeWebhookHandler<(typeof PAYMENT_INTENT_OUTCOME_EVENTS)[number]> = {
    async prepare(event) {
      const id = event.data.object.id;
      const intent = PAYMENT_INTENT_ID.test(id)
        ? await deps.gateway().retrievePaymentIntent(id)
        : null;
      return (tx) => applyPaymentIntentEvent(tx, intent, deps);
    },
  };
  return {
    "payment_intent.succeeded": handler,
    "payment_intent.payment_failed": handler,
    "payment_intent.requires_action": handler,
  } satisfies Record<(typeof PAYMENT_INTENT_OUTCOME_EVENTS)[number], unknown>;
}

async function applyPaymentIntentEvent(
  tx: Prisma.TransactionClient,
  intent: PaymentIntentSummary | null,
  deps: PaymentIntentWebhookDeps,
): Promise<StripeWebhookAfterCommit | void> {
  const log = logger();
  if (!intent) {
    log.info({ reason: "unknown_payment_intent" }, "payment intent event ignored");
    return;
  }

  const paymentId = await matchPayment(tx, intent);
  if (!paymentId) return;

  const applied = await applyChargeResult(tx, {
    paymentId,
    intent,
    errorCode: intent.lastPaymentErrorCode,
  });
  if (applied.outcome === "ignored") {
    log.warn(
      { bookingRef: applied.bookingRef, reason: applied.reason },
      "payment intent event ignored",
    );
    if (applied.reason === "other_payment_intent") orphanSuccess(intent, applied.bookingRef);
    return;
  }
  log.info(
    {
      bookingRef: applied.bookingRef,
      outcome: applied.outcome,
      paymentStatus: applied.paymentStatus,
      bookingStatus: applied.bookingStatus,
    },
    "payment intent event applied",
  );
  if (applied.enteredRequiresAction) {
    return () => runRequiresActionPort(deps.onPaymentRequiresAction, paymentId, applied.bookingRef);
  }
}

/** A success on a PaymentIntent that is not the current attempt: money to hand back by hand. */
function orphanSuccess(intent: PaymentIntentSummary, bookingRef: string | null): void {
  if (intent.status !== "succeeded") return;
  logger().error(
    { bookingRef, attempt: intent.attempt, alert: "orphan_succeeded_payment_intent" },
    "succeeded PaymentIntent of a previous attempt: manual refund needed (DEC-05)",
  );
}

async function matchPayment(
  tx: Prisma.TransactionClient,
  intent: PaymentIntentSummary,
): Promise<string | null> {
  const log = logger();
  const byIntent = await tx.payment.findUnique({
    where: { stripePaymentIntentId: intent.id },
    select: { id: true },
  });
  if (byIntent) return byIntent.id;

  if (intent.bookingRef === null) {
    log.info({ reason: "no_match" }, "payment intent event ignored");
    return null;
  }
  const booking = await tx.booking.findUnique({
    where: { reference: intent.bookingRef },
    select: {
      reference: true,
      currentPayment: {
        select: { id: true, attempt: true, stripeCustomerId: true, stripePaymentIntentId: true },
      },
    },
  });
  const payment = booking?.currentPayment;
  if (!booking || !payment) {
    log.info({ reason: "no_match" }, "payment intent event ignored");
    return null;
  }
  const bookingRef = booking.reference;
  if (intent.customerId !== payment.stripeCustomerId) {
    log.warn({ bookingRef, reason: "customer_mismatch" }, "payment intent event ignored");
    return null;
  }
  if (intent.attempt === payment.attempt && payment.stripePaymentIntentId === null) {
    return payment.id;
  }
  log.warn(
    {
      bookingRef,
      attempt: intent.attempt,
      currentAttempt: payment.attempt,
      reason: "previous_attempt",
    },
    "payment intent event ignored",
  );
  orphanSuccess(intent, bookingRef);
  return null;
}

/** Production registry: charge outcome events on the test-mode PaymentIntent gateway. */
export const STRIPE_WEBHOOK_HANDLERS: StripeWebhookHandlers = createPaymentIntentWebhookHandlers({
  gateway: stripePaymentIntents,
});
