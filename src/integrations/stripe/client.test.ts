import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { createStripeClient, STRIPE_API_VERSION, StripeConfigError } from "./client";

const fake = (prefix: string) => `${prefix}${"A1b2".repeat(6)}`;

function reasonOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StripeConfigError);
    return (error as StripeConfigError).reason;
  }
  return undefined;
}

describe("createStripeClient", () => {
  it("pins the API version the SDK is typed for", () => {
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
  });

  it("refuses a missing key", () => {
    expect(reasonOf(() => createStripeClient(undefined))).toBe("not_configured");
    expect(reasonOf(() => createStripeClient(""))).toBe("not_configured");
  });

  it("refuses a live key without echoing it", () => {
    const key = fake("sk_live_");
    let message = "";
    try {
      createStripeClient(key);
    } catch (error) {
      message = (error as Error).message;
      expect((error as StripeConfigError).reason).toBe("live_key");
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(key);
    expect(reasonOf(() => createStripeClient(fake("rk_live_")))).toBe("live_key");
  });

  it("refuses an unknown key format", () => {
    expect(reasonOf(() => createStripeClient(fake("pk_test_")))).toBe("unknown_format");
  });

  it("builds a client for a test key without any network call", () => {
    expect(createStripeClient(fake("sk_test_"))).toBeInstanceOf(Stripe);
  });
});
