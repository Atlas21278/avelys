import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StripeConfigError } from "./client";
import {
  BOOKING_REQUEST_FLOW,
  createStripePaymentSetupGateway,
  PaymentSetupError,
  stripeUnavailableReason,
  type SetupIntentStripeClient,
} from "./setup-intents";

// Fake Stripe client: no network, no key. Ids are fake test values.
const customersCreate = vi.fn();
const setupIntentsCreate = vi.fn();
const setupIntentsRetrieve = vi.fn();

const fakeStripe = {
  customers: { create: customersCreate },
  setupIntents: { create: setupIntentsCreate, retrieve: setupIntentsRetrieve },
} as unknown as SetupIntentStripeClient;

const gateway = createStripePaymentSetupGateway(fakeStripe);

function setupIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "seti_Test123",
    object: "setup_intent",
    status: "succeeded",
    usage: "off_session",
    livemode: false,
    metadata: { flow: BOOKING_REQUEST_FLOW },
    customer: "cus_Test123",
    payment_method: "pm_Test123",
    client_secret: "seti_Test123_secret_fake",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  customersCreate.mockResolvedValue({ id: "cus_Test123" });
  setupIntentsCreate.mockResolvedValue(setupIntent({ status: "requires_payment_method" }));
});

describe("createSetupIntent", () => {
  it("creates a dedicated Customer and an off-session card SetupIntent, never an amount", async () => {
    const created = await gateway.createSetupIntent({
      journeyId: "journey-1",
      email: "guest@avelys.test",
    });

    expect(created).toEqual({
      setupIntentId: "seti_Test123",
      clientSecret: "seti_Test123_secret_fake",
    });
    expect(customersCreate).toHaveBeenCalledWith(
      { email: "guest@avelys.test", metadata: { flow: BOOKING_REQUEST_FLOW } },
      { idempotencyKey: "payment-setup:journey-1:customer" },
    );
    expect(setupIntentsCreate).toHaveBeenCalledWith(
      {
        customer: "cus_Test123",
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { flow: BOOKING_REQUEST_FLOW },
      },
      { idempotencyKey: "payment-setup:journey-1:setup-intent" },
    );
    const params = JSON.stringify(setupIntentsCreate.mock.calls[0]?.[0]);
    expect(params).not.toMatch(/amount|email|guest/);
  });

  it("fails when Stripe returns no client secret", async () => {
    setupIntentsCreate.mockResolvedValue(setupIntent({ client_secret: null }));
    await expect(
      gateway.createSetupIntent({ journeyId: "journey-2", email: "guest@avelys.test" }),
    ).rejects.toBeInstanceOf(PaymentSetupError);
  });
});

describe("retrieveSetupIntent", () => {
  it("summarises a SetupIntent without any card detail", async () => {
    setupIntentsRetrieve.mockResolvedValue(setupIntent());
    await expect(gateway.retrieveSetupIntent("seti_Test123")).resolves.toEqual({
      id: "seti_Test123",
      status: "succeeded",
      usage: "off_session",
      livemode: false,
      fromBookingRequestFlow: true,
      customerId: "cus_Test123",
      customerEmail: null,
      paymentMethodId: "pm_Test123",
    });
    expect(setupIntentsRetrieve).toHaveBeenCalledWith("seti_Test123", { expand: ["customer"] });
  });

  it("reads expanded customer and payment method objects by id", async () => {
    setupIntentsRetrieve.mockResolvedValue(
      setupIntent({
        customer: { id: "cus_Expanded1", email: "guest@avelys.test" },
        payment_method: { id: "pm_Expanded1", card: { last4: "4242" } },
      }),
    );
    const summary = await gateway.retrieveSetupIntent("seti_Test123");
    expect(summary?.customerId).toBe("cus_Expanded1");
    expect(summary?.customerEmail).toBe("guest@avelys.test");
    expect(summary?.paymentMethodId).toBe("pm_Expanded1");
    expect(JSON.stringify(summary)).not.toMatch(/4242/);
  });

  it("reads no email from a deleted Customer or a Customer without one", async () => {
    setupIntentsRetrieve.mockResolvedValue(
      setupIntent({ customer: { id: "cus_Deleted1", deleted: true } }),
    );
    await expect(gateway.retrieveSetupIntent("seti_Test123")).resolves.toMatchObject({
      customerEmail: null,
    });
    setupIntentsRetrieve.mockResolvedValue(
      setupIntent({ customer: { id: "cus_NoEmail1", email: null } }),
    );
    await expect(gateway.retrieveSetupIntent("seti_Test123")).resolves.toMatchObject({
      customerEmail: null,
    });
  });

  it("flags a SetupIntent from another flow and missing references", async () => {
    setupIntentsRetrieve.mockResolvedValue(
      setupIntent({ metadata: {}, customer: null, payment_method: null }),
    );
    const summary = await gateway.retrieveSetupIntent("seti_Test123");
    expect(summary).toMatchObject({
      fromBookingRequestFlow: false,
      customerId: null,
      paymentMethodId: null,
    });
  });

  it("returns null for an id Stripe does not know", async () => {
    setupIntentsRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such setupintent",
      }),
    );
    await expect(gateway.retrieveSetupIntent("seti_Unknown1")).resolves.toBeNull();
  });

  it("propagates any other Stripe failure", async () => {
    setupIntentsRetrieve.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ type: "api_error", message: "Stripe is down" }),
    );
    await expect(gateway.retrieveSetupIntent("seti_Test123")).rejects.toBeInstanceOf(
      Stripe.errors.StripeAPIError,
    );
  });
});

describe("stripeUnavailableReason", () => {
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
    [
      "a network failure",
      new Stripe.errors.StripeConnectionError({ type: "api_error", message: "down" }),
      "stripe_error",
    ],
  ])("tags %s without its message", (_label, error, reason) => {
    expect(stripeUnavailableReason(error)).toBe(reason);
  });

  it("returns null for any other error", () => {
    expect(stripeUnavailableReason(new TypeError("bug"))).toBeNull();
    expect(stripeUnavailableReason("oops")).toBeNull();
  });
});
