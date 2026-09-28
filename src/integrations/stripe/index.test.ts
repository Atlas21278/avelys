import { describe, expect, it, vi } from "vitest";

const serverEnv = vi.fn(() => ({
  STRIPE_SECRET_KEY: undefined as string | undefined,
  STRIPE_WEBHOOK_SECRET: undefined as string | undefined,
}));

vi.mock("@/lib/env/server", () => ({ serverEnv: () => serverEnv() }));

const { stripeClient, stripeWebhooks, StripeConfigError, StripeWebhookError } =
  await import("./index");

describe("Stripe adapter wiring", () => {
  it("reads no environment at import or when the verifier is created", () => {
    stripeWebhooks();
    expect(serverEnv).not.toHaveBeenCalled();
  });

  it("fails with a typed error on first use when the secret key is not configured", () => {
    expect(() => stripeClient()).toThrowError(StripeConfigError);
    expect(serverEnv).toHaveBeenCalled();
  });

  it("fails as not configured when the webhook signing secret is missing", () => {
    expect(() => stripeWebhooks().verifyWebhookEvent("{}", "t=1,v1=x")).toThrowError(
      StripeWebhookError,
    );
  });
});
