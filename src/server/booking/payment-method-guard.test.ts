import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentSetupGateway, SetupIntentSummary } from "@/integrations/stripe";

import {
  createStripePaymentMethodGuard,
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
  paymentMethodId: "pm_Test123",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  retrieveSetupIntent.mockResolvedValue(SUCCEEDED);
});

function check(paymentSetupId: string | undefined) {
  return guard.confirmedPaymentMethod({ paymentSetupId });
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

  it("logs no Stripe id", async () => {
    retrieveSetupIntent.mockResolvedValue({ ...SUCCEEDED, status: "requires_payment_method" });
    await check("seti_Test123");
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/seti_|cus_|pm_/);
  });

  it("propagates a Stripe failure instead of reporting a missing payment method", async () => {
    retrieveSetupIntent.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(check("seti_Test123")).rejects.toThrow("Stripe unavailable");
  });
});
