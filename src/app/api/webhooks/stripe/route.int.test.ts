import { randomBytes, randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { StripeWebhookHandlers } from "@/server/payments/webhook-handlers";

// End to end through the route: real signature verification (events signed locally with a
// throwaway secret, no Stripe network call) and the real test database.

// Generated per run and set before the environment is first read: never a real Stripe secret.
const SECRET = `whsec_${randomBytes(24).toString("hex")}`;
vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);

// Mutable registry standing in for the (empty) production one.
const handlers: { current: StripeWebhookHandlers } = { current: {} };
vi.mock("@/server/payments/webhook-handlers", () => ({
  get STRIPE_WEBHOOK_HANDLERS() {
    return handlers.current;
  },
}));

const { POST } = await import("./route");
const { db } = await import("@/server/db");

function signedEvent(type = "payment_intent.succeeded") {
  const id = `evt_${randomUUID().replaceAll("-", "")}`;
  const body = JSON.stringify({
    id,
    object: "event",
    type,
    livemode: false,
    created: 1_790_000_000,
    api_version: Stripe.API_VERSION,
    data: { object: { id: "pi_test0001", object: "payment_intent" } },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return { id, body, signature };
}

function deliver(body: string, signature: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["stripe-signature"] = signature;
  return POST(
    new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers, body }),
  );
}

const rowCount = (eventId?: string) =>
  db().processedWebhookEvent.count({ where: eventId ? { eventId } : {} });

describe("POST /api/webhooks/stripe (integration)", () => {
  beforeEach(async () => {
    handlers.current = {};
    await db().processedWebhookEvent.deleteMany();
  });

  afterAll(async () => {
    await db().processedWebhookEvent.deleteMany();
    await db().$disconnect();
    vi.unstubAllEnvs();
  });

  it("records a signed event without handler and answers 200", async () => {
    const { id, body, signature } = signedEvent("customer.created");
    const response = await deliver(body, signature);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(await rowCount(id)).toBe(1);
  });

  it("refuses a missing or invalid signature with 400 and writes nothing", async () => {
    const { body, signature } = signedEvent();
    const forged = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: `whsec_${randomBytes(24).toString("hex")}`,
    });

    const altered = signature.replace(/v1=(.)/, (_, first: string) =>
      first === "0" ? "v1=1" : "v1=0",
    );
    for (const header of [null, "", forged, altered]) {
      const response = await deliver(body, header);
      const payload = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(400);
      expect(payload.error.code).toBe("INVALID_WEBHOOK_SIGNATURE");
    }
    // A signature valid for another body does not transfer.
    const other = signedEvent();
    expect((await deliver(other.body, signature)).status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it("answers 200 without effect when the same event is delivered again", async () => {
    const handler = vi.fn(async () => {});
    handlers.current = { "payment_intent.succeeded": handler };
    const { id, body, signature } = signedEvent();

    expect((await deliver(body, signature)).status).toBe(200);
    expect((await deliver(body, signature)).status).toBe(200);

    expect(await rowCount(id)).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("processes concurrent deliveries of the same event once", async () => {
    const handler = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    handlers.current = { "payment_intent.succeeded": handler };
    const { id, body, signature } = signedEvent();

    const responses = await Promise.all([1, 2, 3].map(() => deliver(body, signature)));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(await rowCount(id)).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("answers 500 and records nothing when the handler fails; the next delivery is processed", async () => {
    handlers.current = {
      "payment_intent.succeeded": async () => {
        throw new Error("handler failed");
      },
    };
    const { id, body, signature } = signedEvent();

    const failed = await deliver(body, signature);
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe(
      "INTERNAL_ERROR",
    );
    expect(await rowCount(id)).toBe(0);

    const handler = vi.fn(async () => {});
    handlers.current = { "payment_intent.succeeded": handler };
    expect((await deliver(body, signature)).status).toBe(200);
    expect(await rowCount(id)).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
  });
});
