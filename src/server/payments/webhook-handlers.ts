import "server-only";

import type Stripe from "stripe";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Registry of Stripe webhook handlers (VTC-030): event type → handler. Empty in this ticket;
 * the payment tickets (EPIC-10) add theirs.
 *
 * A handler runs inside the transaction that records the event id: it writes through `tx` only,
 * so that a failure rolls back both and Stripe's retry is processed again. External effects
 * (email, Stripe calls) are never made from a handler: they run after commit (BR-50).
 * Stripe status and Booking status stay separate (BR-41): a handler updates Payment, and the
 * Booking only through the central transition table.
 */
export type StripeWebhookHandler<T extends Stripe.Event["type"] = Stripe.Event["type"]> = (
  event: Extract<Stripe.Event, { type: T }>,
  tx: Prisma.TransactionClient,
) => Promise<void>;

export type StripeWebhookHandlers = {
  readonly [T in Stripe.Event["type"]]?: StripeWebhookHandler<T>;
};

export const STRIPE_WEBHOOK_HANDLERS: StripeWebhookHandlers = {};
