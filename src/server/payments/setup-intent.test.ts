import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PaymentSetupError,
  StripeConfigError,
  type PaymentSetupGateway,
} from "@/integrations/stripe";

import { createPaymentSetup, PaymentSetupRequestError } from "./setup-intent";

// Mocked Stripe gateway: no network, no key. Values are fake test values.
const createSetupIntent = vi.fn<PaymentSetupGateway["createSetupIntent"]>();
const gateway = vi.fn((): PaymentSetupGateway => ({
  createSetupIntent,
  retrieveSetupIntent: () => Promise.reject(new Error("not used")),
}));
const deps = { gateway, newJourneyId: () => "journey-test-1" };

beforeEach(() => {
  vi.clearAllMocks();
  createSetupIntent.mockResolvedValue({
    setupIntentId: "seti_Test123",
    clientSecret: "seti_Test123_secret_fake",
  });
});

async function refusal(input: unknown): Promise<PaymentSetupRequestError> {
  const error: unknown = await createPaymentSetup(input, deps).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(PaymentSetupRequestError);
  return error as PaymentSetupRequestError;
}

describe("createPaymentSetup", () => {
  it("returns the client secret only, with a normalised email and a server journey id", async () => {
    await expect(createPaymentSetup({ email: "  Guest@Avelys.TEST " }, deps)).resolves.toEqual({
      clientSecret: "seti_Test123_secret_fake",
    });
    expect(createSetupIntent).toHaveBeenCalledWith({
      journeyId: "journey-test-1",
      email: "guest@avelys.test",
    });
  });

  it("draws a fresh journey id per call by default", async () => {
    await createPaymentSetup({ email: "guest@avelys.test" }, { gateway });
    await createPaymentSetup({ email: "guest@avelys.test" }, { gateway });
    const [first, second] = createSetupIntent.mock.calls.map(([input]) => input.journeyId);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it.each([
    ["no email", {}],
    ["an invalid email", { email: "not-an-email" }],
    ["a client amount", { email: "guest@avelys.test", amountCents: 100 }],
    ["a client Stripe customer", { email: "guest@avelys.test", customer: "cus_Other1" }],
    ["a non-object body", "guest@avelys.test"],
  ])("refuses %s with INVALID_INPUT without calling Stripe", async (_label, input) => {
    const error = await refusal(input);
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).not.toContain("guest");
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing key", new StripeConfigError("not_configured"), "stripe_not_configured"],
    ["a live key", new StripeConfigError("live_key"), "stripe_live_key"],
    [
      "a missing client secret",
      new PaymentSetupError("missing_client_secret"),
      "missing_client_secret",
    ],
    [
      "a Stripe API failure",
      new Stripe.errors.StripeAPIError({ type: "api_error", message: "guest@avelys.test" }),
      "stripe_error",
    ],
  ])("maps %s to PAYMENT_UNAVAILABLE without the Stripe error", async (_label, cause, reason) => {
    createSetupIntent.mockRejectedValue(cause);
    const error = await refusal({ email: "guest@avelys.test" });
    expect(error.code).toBe("PAYMENT_UNAVAILABLE");
    expect(error.reason).toBe(reason);
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("guest");
  });

  it("refuses a live key before any Stripe call (VTC-030 guard)", async () => {
    const error: unknown = await createPaymentSetup(
      { email: "guest@avelys.test" },
      {
        gateway: () => {
          throw new StripeConfigError("live_key");
        },
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentSetupRequestError);
    expect((error as PaymentSetupRequestError).reason).toBe("stripe_live_key");
  });

  it("derives the Stripe idempotency keys from the browser's submissionId (double click)", async () => {
    const submissionId = "3b241101-e2bb-4255-8caf-4136c566a962";
    await createPaymentSetup({ email: "guest@avelys.test", submissionId }, deps);
    await createPaymentSetup({ email: "guest@avelys.test", submissionId }, deps);
    const journeyIds = createSetupIntent.mock.calls.map(([input]) => input.journeyId);
    expect(journeyIds).toEqual([submissionId, submissionId]);
  });

  it.each([
    ["not a UUID", "double-click-1"],
    ["a UUID of another version", "3b241101-e2bb-1255-8caf-4136c566a962"],
    ["a non-string", 42],
  ])("refuses a submissionId that is %s with INVALID_INPUT", async (_label, submissionId) => {
    const error = await refusal({ email: "guest@avelys.test", submissionId });
    expect(error.code).toBe("INVALID_INPUT");
    expect(gateway).not.toHaveBeenCalled();
  });

  it("maps a reused submissionId with another email to PAYMENT_SETUP_CONFLICT", async () => {
    createSetupIntent.mockRejectedValue(
      new Stripe.errors.StripeIdempotencyError({
        type: "idempotency_error",
        message: "Keys for idempotent requests can only be used with the same parameters",
      }),
    );
    const error = await refusal({
      email: "other@avelys.test",
      submissionId: "3b241101-e2bb-4255-8caf-4136c566a962",
    });
    expect(error.code).toBe("PAYMENT_SETUP_CONFLICT");
    expect(error.reason).toBe("submission_id_reused");
    expect(error.cause).toBeUndefined();
  });

  it("lets an unexpected error through", async () => {
    createSetupIntent.mockRejectedValue(new TypeError("bug"));
    await expect(createPaymentSetup({ email: "guest@avelys.test" }, deps)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
