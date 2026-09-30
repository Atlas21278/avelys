import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPaymentSetup,
  PaymentSetupRequestError,
  type PaymentSetup,
} from "@/server/payments/setup-intent";

// Only the production wiring (index.ts) is replaced: the real service runs against a fake
// gateway, so no Stripe call and no key are involved.
const createSetupIntent = vi.fn(() =>
  Promise.resolve({ setupIntentId: "seti_Test123", clientSecret: "seti_Test123_secret_fake" }),
);
const requestPaymentSetup = vi.fn((input: unknown): Promise<PaymentSetup> =>
  createPaymentSetup(input, {
    gateway: () => ({
      createSetupIntent,
      retrieveSetupIntent: () => Promise.reject(new Error("not used")),
    }),
  }),
);
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/server/payments", async () => {
  const actual = await import("@/server/payments/setup-intent");
  return {
    requestPaymentSetup: (input: unknown) => requestPaymentSetup(input),
    PaymentSetupRequestError: actual.PaymentSetupRequestError,
  };
});
const publicBookingEnabled = vi.fn(() => true);
vi.mock("@/lib/logger", () => ({ logger: () => log }));
vi.mock("@/server/public-booking", () => ({ publicBookingEnabled: () => publicBookingEnabled() }));

const { POST } = await import("./route");

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/payment-setups", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  publicBookingEnabled.mockReturnValue(true);
});

describe("POST /api/v1/payment-setups", () => {
  it("returns the client secret only, never cached", async () => {
    const response = await post(JSON.stringify({ email: "guest@avelys.test" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      paymentSetup: { clientSecret: "seti_Test123_secret_fake" },
    });
  });

  it("answers 404 without any Stripe call when public booking is off (default)", async () => {
    publicBookingEnabled.mockReturnValue(false);
    const response = await post(JSON.stringify({ email: "guest@avelys.test" }));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(requestPaymentSetup).not.toHaveBeenCalled();
    expect(createSetupIntent).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the environment cannot be read", async () => {
    publicBookingEnabled.mockImplementation(() => {
      throw new Error("Invalid or missing environment variables: DATABASE_URL (invalid_type)");
    });
    const response = await post(JSON.stringify({ email: "guest@avelys.test" }));
    expect(response.status).toBe(500);
    expect(createSetupIntent).not.toHaveBeenCalled();
  });

  it("draws its own correlation id, ignoring the client's x-request-id", async () => {
    const response = await post("{not json", { "x-request-id": "client-chosen-id-123" });
    const body = (await response.json()) as { error: { correlationId: string } };
    expect(body.error.correlationId).not.toBe("client-chosen-id-123");
    expect(body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).toBe(body.error.correlationId);
  });

  it("derives one journey from a submissionId sent twice (double click)", async () => {
    const payload = JSON.stringify({
      email: "guest@avelys.test",
      submissionId: "3b241101-e2bb-4255-8caf-4136c566a962",
    });
    const [first, second] = await Promise.all([post(payload), post(payload)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const journeyIds = createSetupIntent.mock.calls.map(
      (call) => (call as unknown as [{ journeyId: string }])[0].journeyId,
    );
    expect(journeyIds).toEqual([
      "3b241101-e2bb-4255-8caf-4136c566a962",
      "3b241101-e2bb-4255-8caf-4136c566a962",
    ]);
  });

  it("answers 409 PAYMENT_SETUP_CONFLICT when a submissionId is reused with another email", async () => {
    requestPaymentSetup.mockRejectedValueOnce(
      new PaymentSetupRequestError("PAYMENT_SETUP_CONFLICT", "submission_id_reused"),
    );
    const response = await post(
      JSON.stringify({
        email: "other@avelys.test",
        submissionId: "3b241101-e2bb-4255-8caf-4136c566a962",
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYMENT_SETUP_CONFLICT");
  });

  it("logs neither the email, the client secret nor a Stripe id", async () => {
    await post(JSON.stringify({ email: "guest@avelys.test" }));
    const logged = JSON.stringify([log.info.mock.calls, log.error.mock.calls]);
    expect(logged).not.toMatch(/guest|secret_fake|seti_/);
  });

  it("refuses invalid JSON with INVALID_INPUT", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; correlationId: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.correlationId).toBeTruthy();
    expect(requestPaymentSetup).not.toHaveBeenCalled();
  });

  it("refuses a client amount with INVALID_INPUT, in English when asked", async () => {
    const response = await post(JSON.stringify({ email: "guest@avelys.test", amountCents: 1 }), {
      "accept-language": "en-GB",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toBe("The request is incomplete or invalid.");
    expect(createSetupIntent).not.toHaveBeenCalled();
  });

  it("answers 503 PAYMENT_UNAVAILABLE when Stripe is not usable (no key, live key)", async () => {
    requestPaymentSetup.mockRejectedValueOnce(
      new PaymentSetupRequestError("PAYMENT_UNAVAILABLE", "stripe_live_key"),
    );
    const response = await post(JSON.stringify({ email: "guest@avelys.test" }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYMENT_UNAVAILABLE");
    expect(log.error).toHaveBeenCalledWith(
      { code: "PAYMENT_UNAVAILABLE", reason: "stripe_live_key" },
      "payment setup refused",
    );
  });

  it("answers 500 INTERNAL_ERROR on an unexpected failure, logging its name only", async () => {
    requestPaymentSetup.mockRejectedValueOnce(new TypeError("guest@avelys.test"));
    const response = await post(JSON.stringify({ email: "guest@avelys.test" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("guest");
  });
});
