import "server-only";

import type Stripe from "stripe";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { stripeWebhooks, type StripeWebhookVerifier } from "@/integrations/stripe";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

import {
  STRIPE_WEBHOOK_HANDLERS,
  type StripeWebhookAfterCommit,
  type StripeWebhookHandler,
  type StripeWebhookHandlers,
  type StripeWebhookTransactionStep,
} from "./webhook-handlers";

export { StripeWebhookError, type StripeWebhookErrorCode } from "@/integrations/stripe";

export type ProcessedWebhook = {
  /** `duplicate`: the event id was already recorded, nothing was done. */
  outcome: "processed" | "duplicate";
  /** Whether a handler ran for this delivery (false: recorded only, or duplicate). */
  handled: boolean;
};

export type ReceivedWebhook = ProcessedWebhook & { eventId: string; eventType: string };

/**
 * A verified event could not be processed (handler or database failure): the transaction was
 * rolled back and nothing is recorded. Carries the event identity for the logs, never its payload.
 */
export class StripeWebhookProcessingError extends Error {
  constructor(
    readonly eventId: string,
    readonly eventType: string,
    options: { cause: unknown },
  ) {
    super("Stripe webhook processing failed", options);
    this.name = "StripeWebhookProcessingError";
  }
}

type Deps = { db?: PrismaClient; handlers?: StripeWebhookHandlers };

/**
 * Entry point of the webhook route: verifies the signature over the raw body (a
 * `StripeWebhookError` otherwise, nothing written), then records and dispatches the event.
 */
export async function receiveStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: Deps & { verifier?: StripeWebhookVerifier } = {},
): Promise<ReceivedWebhook> {
  const event = (deps.verifier ?? stripeWebhooks()).verifyWebhookEvent(rawBody, signature);
  try {
    const result = await processStripeWebhookEvent(event, deps);
    return { eventId: event.id, eventType: event.type, ...result };
  } catch (error) {
    throw new StripeWebhookProcessingError(event.id, event.type, { cause: error });
  }
}

/**
 * Records a verified Stripe event and runs its handler, exactly once (BR-42).
 *
 * The event id is inserted with `ON CONFLICT DO NOTHING` in the same transaction as the handler
 * writes. An already recorded id (sequential replay) inserts nothing: no effect. Under a
 * concurrent delivery, the unique index makes the second insert wait for the first transaction:
 * once it commits, the second inserts nothing; if it rolls back, the second proceeds. A handler
 * failure rolls back the insert too, so Stripe's next retry is processed again.
 *
 * VTC-033: a handler with `prepare` reads Stripe before the transaction opens (a failure there
 * records nothing, Stripe retries); the effect it may return runs after commit, and its failure
 * is logged without failing the delivery (BR-50).
 */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
  deps: Deps = {},
): Promise<ProcessedWebhook> {
  const client = deps.db ?? db();
  const handlers = deps.handlers ?? STRIPE_WEBHOOK_HANDLERS;
  // The registry is keyed by type, so the handler matches this event's variant.
  const handler = handlers[event.type] as StripeWebhookHandler | undefined;

  let step: StripeWebhookTransactionStep | undefined;
  if (typeof handler === "function") {
    step = (tx) => handler(event, tx);
  } else if (handler) {
    // A delivery already recorded is answered without reading Stripe again. A concurrent
    // duplicate may still prepare: the unique index below keeps its effect single.
    const seen = await client.processedWebhookEvent.findUnique({
      where: { provider_eventId: { provider: "STRIPE", eventId: event.id } },
      select: { id: true },
    });
    if (seen) return { outcome: "duplicate", handled: false };
    // Outside the transaction (VTC-033): network reads never hold a database transaction open.
    step = await handler.prepare(event);
  }

  const { result, afterCommit } = await client.$transaction(
    async (
      tx: Prisma.TransactionClient,
    ): Promise<{ result: ProcessedWebhook; afterCommit?: StripeWebhookAfterCommit }> => {
      const { count } = await tx.processedWebhookEvent.createMany({
        data: [{ provider: "STRIPE", eventId: event.id, eventType: event.type }],
        skipDuplicates: true,
      });
      if (count === 0) return { result: { outcome: "duplicate", handled: false } };

      const effect = step ? await step(tx) : undefined;
      return {
        result: { outcome: "processed", handled: step !== undefined },
        ...(effect ? { afterCommit: effect } : {}),
      };
    },
  );

  if (afterCommit) {
    // After commit (BR-50): a failure is logged, never fails the webhook nor changes any state.
    try {
      await afterCommit();
    } catch (error) {
      logger().error(
        {
          eventId: event.id,
          eventType: event.type,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "stripe webhook after-commit effect failed",
      );
    }
  }
  return result;
}
