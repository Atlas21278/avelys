import type { SetupIntentResult } from "@stripe/stripe-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadStripe = vi.fn();
vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: (key: string) => loadStripe(key) }));

const { StripeBrowserKeyError, confirmationOf, paymentElementsOptions, stripeBrowser } =
  await import("./browser");

// Throwaway values built at run time: no key literal in the repository.
const fake = (prefix: string) => `${prefix}${"A1b2".repeat(6)}`;

beforeEach(() => loadStripe.mockReset());

describe("stripeBrowser", () => {
  it("loads Stripe.js once per test-mode publishable key", async () => {
    const stripe = {};
    loadStripe.mockResolvedValue(stripe);
    const key = fake("pk_test_");
    await expect(stripeBrowser(key)).resolves.toBe(stripe);
    await stripeBrowser(key);
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it("refuses a live or unknown key without loading Stripe.js nor echoing the key", async () => {
    for (const key of [fake("pk_live_"), fake("sk_test_"), "nonsense"]) {
      const error = await stripeBrowser(key).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StripeBrowserKeyError);
      expect(String((error as Error).message)).not.toContain(key);
    }
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it("loads again after a failed load", async () => {
    const key = fake("pk_test_") + "retry";
    loadStripe.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    await expect(stripeBrowser(key)).rejects.toThrow();
    await expect(stripeBrowser(key)).resolves.toEqual({});
    expect(loadStripe).toHaveBeenCalledTimes(2);
  });
});

describe("paymentElementsOptions", () => {
  it("passes the client secret and the page language", () => {
    expect(paymentElementsOptions("seti_1_secret_x", "en")).toMatchObject({
      clientSecret: "seti_1_secret_x",
      locale: "en",
    });
  });
});

const result = (value: unknown) => value as SetupIntentResult;

describe("confirmationOf (stripe.confirmSetup result)", () => {
  it("gives the id of a succeeded SetupIntent, nothing else", () => {
    expect(
      confirmationOf(
        result({ setupIntent: { id: "seti_1", status: "succeeded", client_secret: "s" } }),
      ),
    ).toEqual({ ok: true, paymentSetupId: "seti_1" });
  });

  it.each(["requires_payment_method", "requires_action", "processing", "canceled"])(
    "treats a %s SetupIntent as not saved",
    (status) => {
      expect(confirmationOf(result({ setupIntent: { id: "seti_1", status } }))).toEqual({
        ok: false,
        message: null,
      });
    },
  );

  it.each(["card_error", "validation_error"])("keeps Stripe's localised %s message", (type) => {
    expect(
      confirmationOf(result({ error: { type, message: "Votre carte a été refusée." } })),
    ).toEqual({ ok: false, message: "Votre carte a été refusée." });
  });

  it.each(["api_error", "api_connection_error", "invalid_request_error", "rate_limit_error"])(
    "hides the technical message of a %s",
    (type) => {
      expect(
        confirmationOf(result({ error: { type, message: "No such setupintent: seti_…" } })),
      ).toEqual({ ok: false, message: null });
    },
  );
});
