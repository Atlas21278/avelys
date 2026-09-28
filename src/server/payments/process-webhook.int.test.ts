import { randomUUID } from "node:crypto";

import type Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";

import { processStripeWebhookEvent } from "./process-webhook";
import type { StripeWebhookHandler, StripeWebhookHandlers } from "./webhook-handlers";

// Runs against the real test database (vitest "integration" project), migrations applied.
// No Stripe network call: events are plain objects, already "verified".

const ENTITY = "test.stripeWebhook";

function event(type: Stripe.Event["type"] = "payment_intent.succeeded"): Stripe.Event {
  return {
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    livemode: false,
    created: 1_790_000_000,
    data: { object: { id: "pi_test0001", object: "payment_intent" } },
  } as unknown as Stripe.Event;
}

/** Handler writing through the transaction, so that its writes can be observed or rolled back. */
function writingHandler(
  spy: (eventId: string) => void,
  fail = false,
): StripeWebhookHandler<"payment_intent.succeeded"> {
  return async (received, tx) => {
    spy(received.id);
    await tx.auditLog.create({
      data: { actorType: "SYSTEM", entityType: ENTITY, entityId: received.id, action: "test" },
    });
    // Leave time for a concurrent delivery to reach the unique index.
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (fail) throw new Error("handler failed");
  };
}

const rows = (eventId: string) =>
  db().processedWebhookEvent.findMany({ where: { provider: "STRIPE", eventId } });
const handlerWrites = (eventId: string) =>
  db().auditLog.count({ where: { entityType: ENTITY, entityId: eventId } });

describe("processStripeWebhookEvent (integration)", () => {
  beforeEach(async () => {
    await db().processedWebhookEvent.deleteMany();
    await db().auditLog.deleteMany({ where: { entityType: ENTITY } });
  });

  afterAll(async () => {
    await db().processedWebhookEvent.deleteMany();
    await db().auditLog.deleteMany({ where: { entityType: ENTITY } });
    await db().$disconnect();
  });

  it("records a new event and runs its handler once", async () => {
    const spy = vi.fn();
    const handlers: StripeWebhookHandlers = { "payment_intent.succeeded": writingHandler(spy) };
    const received = event();

    const result = await processStripeWebhookEvent(received, { handlers });

    expect(result).toEqual({ outcome: "processed", handled: true });
    const [row, ...others] = await rows(received.id);
    expect(others).toHaveLength(0);
    expect(row).toMatchObject({ eventId: received.id, eventType: "payment_intent.succeeded" });
    expect(row?.receivedAt).toBeInstanceOf(Date);
    expect(spy).toHaveBeenCalledOnce();
    expect(await handlerWrites(received.id)).toBe(1);
  });

  it("records an event whose type has no handler", async () => {
    const received = event("customer.created");
    const result = await processStripeWebhookEvent(received, { handlers: {} });
    expect(result).toEqual({ outcome: "processed", handled: false });
    expect(await rows(received.id)).toHaveLength(1);
  });

  it("ignores a replayed event: one row, handler run once", async () => {
    const spy = vi.fn();
    const handlers: StripeWebhookHandlers = { "payment_intent.succeeded": writingHandler(spy) };
    const received = event();

    await processStripeWebhookEvent(received, { handlers });
    const replay = await processStripeWebhookEvent(received, { handlers });

    expect(replay.outcome).toBe("duplicate");
    expect(await rows(received.id)).toHaveLength(1);
    expect(spy).toHaveBeenCalledOnce();
    expect(await handlerWrites(received.id)).toBe(1);
  });

  it("processes concurrent deliveries of the same event exactly once", async () => {
    const spy = vi.fn();
    const handlers: StripeWebhookHandlers = { "payment_intent.succeeded": writingHandler(spy) };
    const received = event();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => processStripeWebhookEvent(received, { handlers })),
    );

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "processed",
    ]);
    expect(await rows(received.id)).toHaveLength(1);
    expect(spy).toHaveBeenCalledOnce();
    expect(await handlerWrites(received.id)).toBe(1);
  });

  it("rolls back the event id and the handler writes when the handler fails, then retries", async () => {
    const spy = vi.fn();
    const received = event();

    await expect(
      processStripeWebhookEvent(received, {
        handlers: { "payment_intent.succeeded": writingHandler(spy, true) },
      }),
    ).rejects.toThrowError("handler failed");
    expect(await rows(received.id)).toHaveLength(0);
    expect(await handlerWrites(received.id)).toBe(0);

    const retry = await processStripeWebhookEvent(received, {
      handlers: { "payment_intent.succeeded": writingHandler(spy) },
    });
    expect(retry.outcome).toBe("processed");
    expect(await rows(received.id)).toHaveLength(1);
    expect(await handlerWrites(received.id)).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("lets a concurrent delivery through when the first one rolls back", async () => {
    const received = event();
    const failing = processStripeWebhookEvent(received, {
      handlers: { "payment_intent.succeeded": writingHandler(vi.fn(), true) },
    });
    // Starts while the failing transaction holds the unique index entry.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const succeeding = processStripeWebhookEvent(received, {
      handlers: { "payment_intent.succeeded": writingHandler(vi.fn()) },
    });

    await expect(failing).rejects.toThrowError("handler failed");
    await expect(succeeding).resolves.toEqual({ outcome: "processed", handled: true });
    expect(await rows(received.id)).toHaveLength(1);
    expect(await handlerWrites(received.id)).toBe(1);
  });
});
