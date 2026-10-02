import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStripePaymentAuthenticationGateway,
  type PaymentAuthenticationStripeClient,
} from "./payment-authentication";
import { PaymentIntentError } from "./payment-intents";

// Fake Stripe client: no network, no key. Ids and client secrets are fake test values.
const retrieve = vi.fn();
const gateway = createStripePaymentAuthenticationGateway({
  paymentIntents: { retrieve },
} as unknown as PaymentAuthenticationStripeClient);

function paymentIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_Test123",
    object: "payment_intent",
    status: "requires_payment_method",
    amount: 4_500,
    currency: "eur",
    livemode: false,
    customer: "cus_Test123",
    client_secret: "pi_Test123_secret_Fake456",
    metadata: { bookingRef: "VTC-ABCD2345", attempt: "1" },
    last_payment_error: { code: "authentication_required" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retrievePaymentIntentForAuthentication", () => {
  it("returns the summary and the client secret", async () => {
    retrieve.mockResolvedValue(paymentIntent());

    const result = await gateway.retrievePaymentIntentForAuthentication("pi_Test123");

    expect(retrieve).toHaveBeenCalledWith("pi_Test123");
    expect(result).toEqual({
      intent: {
        id: "pi_Test123",
        status: "requires_payment_method",
        amountCents: 4_500,
        currency: "EUR",
        livemode: false,
        customerId: "cus_Test123",
        bookingRef: "VTC-ABCD2345",
        attempt: 1,
        lastPaymentErrorCode: "authentication_required",
        lastPaymentErrorDeclineCode: null,
      },
      clientSecret: "pi_Test123_secret_Fake456",
    });
  });

  it("drops a missing or unexpected client secret", async () => {
    retrieve.mockResolvedValueOnce(paymentIntent({ client_secret: null }));
    expect((await gateway.retrievePaymentIntentForAuthentication("pi_Test123"))?.clientSecret).toBe(
      null,
    );
    retrieve.mockResolvedValueOnce(paymentIntent({ client_secret: "not a secret <script>" }));
    expect((await gateway.retrievePaymentIntentForAuthentication("pi_Test123"))?.clientSecret).toBe(
      null,
    );
  });

  it("returns null for an id Stripe does not know", async () => {
    retrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such payment_intent",
      }),
    );
    await expect(gateway.retrievePaymentIntentForAuthentication("pi_Missing1")).resolves.toBeNull();
  });

  it("propagates other Stripe failures", async () => {
    retrieve.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ type: "api_error", message: "Stripe down" }),
    );
    await expect(gateway.retrievePaymentIntentForAuthentication("pi_Test123")).rejects.toThrow(
      Stripe.errors.StripeAPIError,
    );
  });

  it("refuses an id that is not a PaymentIntent id, without calling Stripe", async () => {
    await expect(gateway.retrievePaymentIntentForAuthentication("seti_123")).rejects.toThrow(
      PaymentIntentError,
    );
    expect(retrieve).not.toHaveBeenCalled();
  });
});
