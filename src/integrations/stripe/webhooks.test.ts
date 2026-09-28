import { randomBytes } from "node:crypto";

import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { createStripeWebhookVerifier, StripeWebhookError } from "./webhooks";

// Throwaway signing secret generated per run: never a real Stripe secret.
const SECRET = `whsec_${randomBytes(24).toString("hex")}`;

function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt_test0001",
    object: "event",
    type: "payment_intent.succeeded",
    livemode: false,
    created: 1_790_000_000,
    api_version: Stripe.API_VERSION,
    data: { object: { id: "pi_test0001", object: "payment_intent" } },
    ...overrides,
  });
}

function sign(payload: string, secret = SECRET, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}

const verifier = createStripeWebhookVerifier({ secret: () => SECRET });

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StripeWebhookError);
    return (error as StripeWebhookError).code;
  }
  return undefined;
}

describe("verifyWebhookEvent", () => {
  it("returns the event for a correctly signed body", () => {
    const body = eventBody();
    const event = verifier.verifyWebhookEvent(body, sign(body));
    expect(event).toMatchObject({ id: "evt_test0001", type: "payment_intent.succeeded" });
  });

  it("refuses a missing signature", () => {
    expect(codeOf(() => verifier.verifyWebhookEvent(eventBody(), null))).toBe(
      "INVALID_WEBHOOK_SIGNATURE",
    );
    expect(codeOf(() => verifier.verifyWebhookEvent(eventBody(), ""))).toBe(
      "INVALID_WEBHOOK_SIGNATURE",
    );
  });

  it("refuses a body signed with another secret, a tampered body and an old signature", () => {
    const body = eventBody();
    const other = `whsec_${randomBytes(24).toString("hex")}`;
    expect(codeOf(() => verifier.verifyWebhookEvent(body, sign(body, other)))).toBe(
      "INVALID_WEBHOOK_SIGNATURE",
    );
    expect(
      codeOf(() => verifier.verifyWebhookEvent(eventBody({ type: "charge.refunded" }), sign(body))),
    ).toBe("INVALID_WEBHOOK_SIGNATURE");
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(codeOf(() => verifier.verifyWebhookEvent(body, sign(body, SECRET, anHourAgo)))).toBe(
      "INVALID_WEBHOOK_SIGNATURE",
    );
    expect(codeOf(() => verifier.verifyWebhookEvent(body, "t=1,v1=garbage"))).toBe(
      "INVALID_WEBHOOK_SIGNATURE",
    );
  });

  it("never exposes the payload, the signature or the secret in the error", () => {
    const body = eventBody({ id: "evt_marker0042" });
    const signature = sign(body, `whsec_${randomBytes(24).toString("hex")}`);
    try {
      verifier.verifyWebhookEvent(body, signature);
      expect.unreachable();
    } catch (error) {
      const serialized = JSON.stringify(error) + String(error) + String((error as Error).stack);
      expect(serialized).not.toContain("evt_marker0042");
      expect(serialized).not.toContain(signature);
      expect(serialized).not.toContain(SECRET);
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("refuses a signed body that is not a valid event envelope", () => {
    for (const body of [
      "not json",
      eventBody({ id: "not-an-event-id" }),
      eventBody({ object: "payment_intent" }),
      eventBody({ type: "" }),
      eventBody({ livemode: "false" }),
      eventBody({ livemode: true }),
      eventBody({ data: null }),
    ]) {
      expect(codeOf(() => verifier.verifyWebhookEvent(body, sign(body)))).toBe(
        "INVALID_WEBHOOK_PAYLOAD",
      );
    }
  });

  it("refuses a correctly signed live mode event (test mode only)", () => {
    const body = eventBody({ livemode: true });
    expect(codeOf(() => verifier.verifyWebhookEvent(body, sign(body)))).toBe(
      "INVALID_WEBHOOK_PAYLOAD",
    );
  });

  it("fails as not configured when the signing secret is missing, before any check", () => {
    const unconfigured = createStripeWebhookVerifier({ secret: () => undefined });
    const body = eventBody();
    expect(codeOf(() => unconfigured.verifyWebhookEvent(body, sign(body)))).toBe(
      "WEBHOOK_NOT_CONFIGURED",
    );
    expect(codeOf(() => unconfigured.verifyWebhookEvent(body, null))).toBe(
      "WEBHOOK_NOT_CONFIGURED",
    );
  });
});
