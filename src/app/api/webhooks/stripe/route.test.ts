import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReceivedWebhook } from "@/server/payments/process-webhook";

const receiveStripeWebhook =
  vi.fn<(rawBody: string, signature: string | null) => Promise<ReceivedWebhook>>();
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Only the service entry point is replaced; the error classes are the real ones.
vi.mock("@/server/payments/process-webhook", async () => {
  const { StripeWebhookError } = await import("@/integrations/stripe/webhooks");
  class StripeWebhookProcessingError extends Error {
    constructor(
      readonly eventId: string,
      readonly eventType: string,
      options: { cause: unknown },
    ) {
      super("Stripe webhook processing failed", options);
    }
  }
  return {
    StripeWebhookError,
    StripeWebhookProcessingError,
    receiveStripeWebhook: (rawBody: string, signature: string | null) =>
      receiveStripeWebhook(rawBody, signature),
  };
});
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const { POST } = await import("./route");
const { StripeWebhookError, StripeWebhookProcessingError } =
  await import("@/server/payments/process-webhook");

const RAW_BODY = '{"id":"evt_test0001","marker":"payload-marker-0042"}';
const SIGNATURE = "t=1,v1=signature-marker-0042";
const RECEIVED: ReceivedWebhook = {
  eventId: "evt_test0001",
  eventType: "payment_intent.succeeded",
  outcome: "processed",
  handled: false,
};

function request(signature: string | null = SIGNATURE) {
  const headers: Record<string, string> = { "x-request-id": "stripe-test-0001" };
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: RAW_BODY,
  });
}

type ErrorBody = { error: { code: string; message: string; correlationId: string } };

function allLogs(): string {
  return JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    receiveStripeWebhook.mockReset();
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
  });

  it("hands the raw body and the signature header to the service and answers 200", async () => {
    receiveStripeWebhook.mockResolvedValue(RECEIVED);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(receiveStripeWebhook).toHaveBeenCalledWith(RAW_BODY, SIGNATURE);
    expect(log.info).toHaveBeenCalledWith(RECEIVED, "stripe webhook received");
  });

  it("answers 200 for a duplicate", async () => {
    receiveStripeWebhook.mockResolvedValue({ ...RECEIVED, outcome: "duplicate" });
    expect((await POST(request())).status).toBe(200);
  });

  it("passes a missing signature header as null", async () => {
    receiveStripeWebhook.mockRejectedValue(new StripeWebhookError("INVALID_WEBHOOK_SIGNATURE"));
    expect((await POST(request(null))).status).toBe(400);
    expect(receiveStripeWebhook).toHaveBeenCalledWith(RAW_BODY, null);
  });

  it("answers 400 INVALID_WEBHOOK_SIGNATURE without logging the payload or the header", async () => {
    receiveStripeWebhook.mockRejectedValue(new StripeWebhookError("INVALID_WEBHOOK_SIGNATURE"));

    const response = await POST(request());
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "INVALID_WEBHOOK_SIGNATURE",
      correlationId: "stripe-test-0001",
    });
    expect(body.error.message).not.toBe("");
    expect(log.warn).toHaveBeenCalledWith(
      { code: "INVALID_WEBHOOK_SIGNATURE" },
      "stripe webhook refused",
    );
    expect(allLogs()).not.toContain("payload-marker-0042");
    expect(allLogs()).not.toContain("signature-marker-0042");
  });

  it("answers 400 INVALID_INPUT for a signed body that is not a valid event", async () => {
    receiveStripeWebhook.mockRejectedValue(new StripeWebhookError("INVALID_WEBHOOK_PAYLOAD"));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("INVALID_INPUT");
  });

  it("answers 500 WEBHOOK_NOT_CONFIGURED and logs the code only", async () => {
    receiveStripeWebhook.mockRejectedValue(new StripeWebhookError("WEBHOOK_NOT_CONFIGURED"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(((await response.json()) as ErrorBody).error.code).toBe("WEBHOOK_NOT_CONFIGURED");
    expect(log.error).toHaveBeenCalledWith(
      { code: "WEBHOOK_NOT_CONFIGURED" },
      "stripe webhook refused",
    );
  });

  it("answers 500 when processing fails, logging only the event identity", async () => {
    const cause = new TypeError("handler failed on payload-marker-0042");
    receiveStripeWebhook.mockRejectedValue(
      new StripeWebhookProcessingError("evt_test0001", "payment_intent.succeeded", { cause }),
    );

    const response = await POST(request());
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("payload-marker-0042");
    expect(log.error).toHaveBeenCalledWith(
      { eventId: "evt_test0001", eventType: "payment_intent.succeeded", errorName: "TypeError" },
      "stripe webhook failed",
    );
    expect(allLogs()).not.toContain("payload-marker-0042");
  });

  it("answers 500 on an unexpected error, logging its name only", async () => {
    receiveStripeWebhook.mockRejectedValue(new Error("secret-looking-marker-0042"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith({ errorName: "Error" }, "stripe webhook failed");
    expect(allLogs()).not.toContain("secret-looking-marker-0042");
  });
});
