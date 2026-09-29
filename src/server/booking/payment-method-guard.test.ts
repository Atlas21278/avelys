import { beforeEach, describe, expect, it, vi } from "vitest";

import Stripe from "stripe";

import {
  StripeConfigError,
  type PaymentSetupGateway,
  type SetupIntentSummary,
} from "@/integrations/stripe";

import {
  createStripePaymentMethodGuard,
  PaymentMethodUnavailableError,
  type StripePaymentMethodGuardDeps,
} from "./payment-method-guard";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("@/lib/logger", () => ({ logger: () => log }));

// Mocked Stripe gateway and database: no network, no key. Ids are fake test values.
const retrieveSetupIntent = vi.fn<PaymentSetupGateway["retrieveSetupIntent"]>();
const findUnique = vi.fn();
const gateway = vi.fn((): PaymentSetupGateway => ({
  createSetupIntent: () => Promise.reject(new Error("not used")),
  retrieveSetupIntent,
}));

const guard = createStripePaymentMethodGuard({
  gateway,
  db: { payment: { findUnique } } as unknown as StripePaymentMethodGuardDeps["db"],
});

const SUCCEEDED: SetupIntentSummary = {
  id: "seti_Test123",
  status: "succeeded",
  usage: "off_session",
  livemode: false,
  fromBookingRequestFlow: true,
  customerId: "cus_Test123",
  customerEmail: "guest@avelys.test",
  paymentMethodId: "pm_Test123",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  retrieveSetupIntent.mockResolvedValue(SUCCEEDED);
});

function check(paymentSetupId: string | undefined, email = "guest@avelys.test") {
  return guard.confirmedPaymentMethod({ paymentSetupId, email });
}

function loggedReason(): unknown {
  return (log.info.mock.calls.at(-1)?.[0] as { reason?: unknown } | undefined)?.reason;
}

describe("Stripe payment method guard", () => {
  it("builds without reading the Stripe configuration", () => {
    createStripePaymentMethodGuard({
      gateway,
      db: { payment: { findUnique } } as unknown as StripePaymentMethodGuardDeps["db"],
    });
    expect(gateway).not.toHaveBeenCalled();
  });

  it("returns the Stripe references of a succeeded off-session SetupIntent", async () => {
    await expect(check("seti_Test123")).resolves.toEqual({
      setupIntentId: "seti_Test123",
      customerId: "cus_Test123",
      paymentMethodId: "pm_Test123",
    });
    expect(retrieveSetupIntent).toHaveBeenCalledWith("seti_Test123");
    expect(findUnique).toHaveBeenCalledWith({
      where: { stripeSetupIntentId: "seti_Test123" },
      select: { id: true },
    });
  });

  it.each([
    ["missing", undefined],
    ["malformed", "test-setup"],
    ["malformed", "seti_bad id"],
    ["malformed", "pi_Test123"],
  ])("refuses a %s reference without calling Stripe", async (reason, id) => {
    await expect(check(id)).resolves.toBeNull();
    expect(loggedReason()).toBe(reason);
    expect(retrieveSetupIntent).not.toHaveBeenCalled();
  });

  it("refuses a SetupIntent already used by a booking, without calling Stripe", async () => {
    findUnique.mockResolvedValue({ id: "payment-1" });
    await expect(check("seti_Test123")).resolves.toBeNull();
    expect(loggedReason()).toBe("already_used");
    expect(retrieveSetupIntent).not.toHaveBeenCalled();
  });

  it("refuses an id Stripe does not know", async () => {
    retrieveSetupIntent.mockResolvedValue(null);
    await expect(check("seti_Unknown1")).resolves.toBeNull();
    expect(loggedReason()).toBe("unknown");
  });

  it.each([
    ["not_succeeded", { status: "requires_payment_method" }],
    ["not_succeeded", { status: "requires_action" }],
    ["not_succeeded", { status: "processing" }],
    ["not_succeeded", { status: "canceled" }],
    ["wrong_usage", { usage: "on_session" }],
    ["live_mode", { livemode: true }],
    ["foreign_flow", { fromBookingRequestFlow: false }],
    ["no_customer", { customerId: null }],
    ["no_payment_method", { paymentMethodId: null }],
  ] as const)("refuses with reason %s", async (reason, override) => {
    retrieveSetupIntent.mockResolvedValue({ ...SUCCEEDED, ...override });
    await expect(check("seti_Test123")).resolves.toBeNull();
    expect(loggedReason()).toBe(reason);
  });

  it.each([
    ["the same email", "guest@avelys.test", "guest@avelys.test"],
    ["another case", "Guest@Avelys.TEST", "guest@avelys.test"],
    ["surrounding spaces", "guest@avelys.test", "  guest@avelys.test "],
  ])("accepts a Customer holding %s as the request", async (_label, stored, requested) => {
    retrieveSetupIntent.mockResolvedValue({ ...SUCCEEDED, customerEmail: stored });
    await expect(check("seti_Test123", requested)).resolves.not.toBeNull();
  });

  it.each([
    ["another email", "other@avelys.test"],
    ["no email", null],
  ])("refuses a SetupIntent whose Customer holds %s", async (_label, stored) => {
    retrieveSetupIntent.mockResolvedValue({ ...SUCCEEDED, customerEmail: stored });
    await expect(check("seti_Test123")).resolves.toBeNull();
    expect(loggedReason()).toBe("payment_setup_email_mismatch");
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/avelys\.test/);
  });

  it("logs no Stripe id", async () => {
    retrieveSetupIntent.mockResolvedValue({ ...SUCCEEDED, status: "requires_payment_method" });
    await check("seti_Test123");
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/seti_|cus_|pm_/);
  });

  it.each([
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
  ])("reports %s as unavailable, without the Stripe error", async (_label, failure, reason) => {
    retrieveSetupIntent.mockRejectedValue(failure);
    const error: unknown = await check("seti_Test123").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentMethodUnavailableError);
    expect((error as PaymentMethodUnavailableError).reason).toBe(reason);
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain("guest");
  });

  it("reports a missing or live key as unavailable", async () => {
    gateway.mockImplementationOnce(() => {
      throw new StripeConfigError("not_configured");
    });
    const error: unknown = await check("seti_Test123").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentMethodUnavailableError);
    expect((error as PaymentMethodUnavailableError).reason).toBe("stripe_not_configured");
  });

  it("propagates an unexpected failure as is", async () => {
    retrieveSetupIntent.mockRejectedValue(new TypeError("bug"));
    await expect(check("seti_Test123")).rejects.toBeInstanceOf(TypeError);
  });
});
