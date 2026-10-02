import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyRegularizationToken } from "@/domain/payment/regularization-token";

// Test-only values, not secrets.
const KEY = "unit-tests-only-payment-link-key-000000";
const env = vi.fn(() => ({
  APP_URL: "https://avelys.example",
  PAYMENT_LINK_SECRET: KEY as string | undefined,
}));
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/env/server", () => ({ serverEnv: () => env() }));
vi.mock("@/lib/logger", () => ({ logger: () => log }));
vi.mock("@/server/db", () => ({ db: () => ({}) }));
vi.mock("@/server/auth/access", () => ({ checkAccess: vi.fn() }));

const { paymentRegularizationUrl, resolveRegularizationLink } = await import(
  "./regularization-link"
);

const PAYMENT_ID = "c1x9k2m3n4p5q6r7s8t9u0v1";

function tokenOf(url: string, prefix: string): string {
  expect(url.startsWith(prefix), url).toBe(true);
  return url.slice(prefix.length);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("paymentRegularizationUrl", () => {
  it("builds the French URL without prefix from APP_URL", () => {
    const url = paymentRegularizationUrl(PAYMENT_ID, 1, "fr");
    const token = tokenOf(url!, "https://avelys.example/paiement/");
    expect(verifyRegularizationToken(token, KEY)).toEqual({ paymentId: PAYMENT_ID, attempt: 1 });
  });

  it("builds the English URL under /en with the translated slug (DEC-21)", () => {
    const url = paymentRegularizationUrl(PAYMENT_ID, 2, "en");
    const token = tokenOf(url!, "https://avelys.example/en/payment/");
    expect(verifyRegularizationToken(token, KEY)).toEqual({ paymentId: PAYMENT_ID, attempt: 2 });
  });

  it("gives a different link for each attempt", () => {
    expect(paymentRegularizationUrl(PAYMENT_ID, 1, "fr")).not.toBe(
      paymentRegularizationUrl(PAYMENT_ID, 2, "fr"),
    );
  });

  it("generates no link without PAYMENT_LINK_SECRET and logs a configuration error by name", () => {
    env.mockReturnValue({ APP_URL: "https://avelys.example", PAYMENT_LINK_SECRET: undefined });

    expect(paymentRegularizationUrl(PAYMENT_ID, 1, "fr")).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      { variable: "PAYMENT_LINK_SECRET", reason: "not_configured" },
      expect.any(String),
    );
  });

  it("treats every link as invalid without PAYMENT_LINK_SECRET, before any read", async () => {
    env.mockReturnValue({ APP_URL: "https://avelys.example", PAYMENT_LINK_SECRET: undefined });
    const gateway = vi.fn();

    await expect(resolveRegularizationLink("anything", { gateway })).resolves.toEqual({
      kind: "invalid",
    });
    expect(gateway).not.toHaveBeenCalled();
  });

  it("never logs the token of a refused link", async () => {
    env.mockReturnValue({ APP_URL: "https://avelys.example", PAYMENT_LINK_SECRET: KEY });
    const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    await expect(resolveRegularizationLink(token)).resolves.toEqual({ kind: "invalid" });
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logged).not.toContain(token);
    expect(logged).toContain("bad_token");
  });
});
