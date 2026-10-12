import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  createStripeClient,
  STRIPE_API_VERSION,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_REQUEST_MAX_DURATION_MS,
  STRIPE_TIMEOUT_MS,
  StripeConfigError,
} from "./client";

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

  it("pins the network settings the in-flight window of a charge is derived from", () => {
    const client = createStripeClient(fake("sk_test_"));
    expect(client.getApiField("timeout")).toBe(STRIPE_TIMEOUT_MS);
    expect(client.getMaxNetworkRetries()).toBe(STRIPE_MAX_NETWORK_RETRIES);
    // 3 tries of 80 s plus 2 retry delays of at most 5 s.
    expect(STRIPE_REQUEST_MAX_DURATION_MS).toBe(250_000);
  });

  it("talks to Stripe by default", () => {
    const client = createStripeClient(fake("sk_test_"));
    expect(client.getApiField("host")).toBe("api.stripe.com");
    expect(client.getApiField("protocol")).toBe("https");
  });

  it("targets the local fake Stripe API of the end-to-end tests when asked (VTC-048)", () => {
    const client = createStripeClient(fake("sk_test_"), { apiBaseUrl: "http://127.0.0.1:12111" });
    expect(client.getApiField("host")).toBe("127.0.0.1");
    expect(client.getApiField("port")).toBe(12111);
    expect(client.getApiField("protocol")).toBe("http");
  });

  it("still refuses a live key with a fake API base URL", () => {
    expect(
      reasonOf(() =>
        createStripeClient(fake("sk_live_"), { apiBaseUrl: "http://127.0.0.1:12111" }),
      ),
    ).toBe("live_key");
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
