import { describe, expect, it } from "vitest";

import {
  isTestModePublishableKey,
  isTestModeSecretKey,
  isWebhookSigningSecret,
  stripeKeyProblem,
} from "./keys";

// Shaped placeholders built at runtime: no key-like literal lives in the repository.
const fake = (prefix: string) => `${prefix}${"A1b2".repeat(6)}`;

describe("Stripe test mode guard", () => {
  it("accepts test secret and restricted keys", () => {
    expect(stripeKeyProblem("secret", fake("sk_test_"))).toBeNull();
    expect(stripeKeyProblem("secret", fake("rk_test_"))).toBeNull();
    expect(isTestModeSecretKey(fake("sk_test_"))).toBe(true);
  });

  it("refuses live secret and restricted keys", () => {
    expect(stripeKeyProblem("secret", fake("sk_live_"))).toBe("live_key");
    expect(stripeKeyProblem("secret", fake("rk_live_"))).toBe("live_key");
    expect(isTestModeSecretKey(fake("sk_live_"))).toBe(false);
  });

  it("refuses an unknown secret key format", () => {
    for (const key of [
      "",
      "sk_test_",
      fake("pk_test_"),
      fake("sk_prod_"),
      fake("whsec_"),
      ` ${fake("sk_test_")}`,
      `${fake("sk_test_")}\n`,
    ]) {
      expect(stripeKeyProblem("secret", key)).toBe("unknown_format");
    }
  });

  it("accepts only test publishable keys", () => {
    expect(stripeKeyProblem("publishable", fake("pk_test_"))).toBeNull();
    expect(isTestModePublishableKey(fake("pk_test_"))).toBe(true);
    expect(stripeKeyProblem("publishable", fake("pk_live_"))).toBe("live_key");
    expect(stripeKeyProblem("publishable", fake("sk_test_"))).toBe("unknown_format");
    expect(stripeKeyProblem("publishable", "pk_test_")).toBe("unknown_format");
  });

  it("recognises a webhook signing secret", () => {
    expect(isWebhookSigningSecret(fake("whsec_"))).toBe(true);
    expect(isWebhookSigningSecret("whsec_")).toBe(false);
    expect(isWebhookSigningSecret(fake("sk_test_"))).toBe(false);
  });
});
