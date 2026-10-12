import type { SetupIntentResult } from "@stripe/stripe-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadStripe = vi.fn();
vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: (key: string) => loadStripe(key) }));

const {
  StripeBrowserKeyError,
  authenticatePayment,
  confirmCardSetup,
  confirmationOf,
  paymentElementsOptions,
  returnUrlOf,
  stripeBrowser,
} = await import("./browser");

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

describe("returnUrlOf", () => {
  it("drops the query string and the hash (free-text addresses never reach Stripe)", () => {
    const url = new URL("https://avelys.test/reservation?pickup=12%20rue%20X&dropoff=Orly#top");
    expect(returnUrlOf(url)).toBe("https://avelys.test/reservation");
    expect(returnUrlOf(new URL("https://avelys.test/en/booking?pickup=x"))).toBe(
      "https://avelys.test/en/booking",
    );
  });
});

describe("confirmCardSetup (mocked Stripe.js)", () => {
  const elements = {} as Parameters<typeof confirmCardSetup>[1]["elements"];
  const input = { elements, clientSecret: "seti_1_secret_x", returnUrl: "https://avelys.test/r" };
  const succeeded = () => Promise.resolve({ setupIntent: { id: "seti_1", status: "succeeded" } });
  const stripe = (
    confirm: () => Promise<unknown>,
    retrieve: () => Promise<unknown> = () => Promise.reject(new Error("unused")),
  ) => ({
    confirmSetup: vi.fn(confirm as () => Promise<SetupIntentResult>),
    retrieveSetupIntent: vi.fn(retrieve as () => Promise<SetupIntentResult>),
  });

  it("confirms without redirection, with the clean return URL", async () => {
    const client = stripe(succeeded);
    await expect(confirmCardSetup(client, input)).resolves.toEqual({
      ok: true,
      paymentSetupId: "seti_1",
    });
    expect(client.confirmSetup).toHaveBeenCalledWith({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: "https://avelys.test/r" },
    });
    expect(client.retrieveSetupIntent).not.toHaveBeenCalled();
  });

  it("keeps Stripe's message on a card refusal, without reading the SetupIntent back", async () => {
    const client = stripe(() =>
      Promise.resolve({ error: { type: "card_error", message: "Carte refusée." } }),
    );
    await expect(confirmCardSetup(client, input)).resolves.toEqual({
      ok: false,
      message: "Carte refusée.",
    });
    expect(client.retrieveSetupIntent).not.toHaveBeenCalled();
  });

  it("recovers a SetupIntent that already succeeded (retry after a lost answer)", async () => {
    const client = stripe(
      () =>
        Promise.resolve({
          error: { type: "invalid_request_error", code: "setup_intent_unexpected_state" },
        }),
      succeeded,
    );
    await expect(confirmCardSetup(client, input)).resolves.toEqual({
      ok: true,
      paymentSetupId: "seti_1",
    });
    expect(client.retrieveSetupIntent).toHaveBeenCalledWith("seti_1_secret_x");
  });

  it("recovers when Stripe.js throws but the SetupIntent succeeded", async () => {
    const client = stripe(() => Promise.reject(new Error("network")), succeeded);
    await expect(confirmCardSetup(client, input)).resolves.toEqual({
      ok: true,
      paymentSetupId: "seti_1",
    });
  });

  it.each([
    [
      "not succeeded",
      () => Promise.resolve({ setupIntent: { id: "seti_1", status: "requires_payment_method" } }),
    ],
    ["an error", () => Promise.resolve({ error: { type: "api_error", message: "boom" } })],
    ["a throw", () => Promise.reject(new Error("network"))],
  ])("gives a generic failure when the read-back is %s", async (_label, retrieve) => {
    const client = stripe(() => Promise.reject(new Error("network")), retrieve);
    await expect(confirmCardSetup(client, input)).resolves.toEqual({ ok: false, message: null });
  });
});

describe("authenticatePayment (VTC-042)", () => {
  // Fake client secret and ids: not secrets.
  const input = {
    clientSecret: "pi_Fake1_secret_Fake2",
    paymentMethodId: "pm_Fake3",
    returnUrl: "https://avelys.example/",
  };
  const intent = (status: string) => ({ paymentIntent: { status } }) as never;
  const cardError = (message: string) => ({ error: { type: "card_error", message } }) as never;

  function client() {
    return {
      confirmPayment: vi.fn(),
      handleNextAction: vi.fn(),
      retrievePaymentIntent: vi.fn(),
    };
  }

  it("confirms the same PaymentIntent with the saved payment method, without redirect", async () => {
    const stripe = client();
    stripe.confirmPayment.mockResolvedValue(intent("succeeded"));

    await expect(authenticatePayment(stripe, { ...input, step: "confirm" })).resolves.toEqual({
      outcome: "settled",
    });
    expect(stripe.confirmPayment).toHaveBeenCalledWith({
      clientSecret: input.clientSecret,
      confirmParams: { payment_method: "pm_Fake3", return_url: "https://avelys.example/" },
      redirect: "if_required",
    });
    expect(stripe.handleNextAction).not.toHaveBeenCalled();
  });

  it("runs the pending action of a requires_action PaymentIntent", async () => {
    const stripe = client();
    stripe.handleNextAction.mockResolvedValue(intent("processing"));

    await expect(authenticatePayment(stripe, { ...input, step: "next_action" })).resolves.toEqual({
      outcome: "settled",
    });
    expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: input.clientSecret });
    expect(stripe.confirmPayment).not.toHaveBeenCalled();
  });

  it("keeps Stripe's localised message for a card error", async () => {
    const stripe = client();
    stripe.confirmPayment.mockResolvedValue(cardError("Authentification refusée."));

    await expect(authenticatePayment(stripe, { ...input, step: "confirm" })).resolves.toEqual({
      outcome: "failed",
      message: "Authentification refusée.",
    });
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it("reads the PaymentIntent back when Stripe.js throws, and trusts only Stripe's status", async () => {
    const stripe = client();
    stripe.confirmPayment.mockRejectedValue(new Error("network"));
    stripe.retrievePaymentIntent.mockResolvedValue(intent("succeeded"));

    await expect(authenticatePayment(stripe, { ...input, step: "confirm" })).resolves.toEqual({
      outcome: "settled",
    });
    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith(input.clientSecret);
  });

  it("fails generically on an API error or an unsettled status", async () => {
    const stripe = client();
    stripe.confirmPayment.mockResolvedValue({ error: { type: "api_error", message: "raw" } });
    stripe.retrievePaymentIntent.mockResolvedValue(intent("requires_payment_method"));

    await expect(authenticatePayment(stripe, { ...input, step: "confirm" })).resolves.toEqual({
      outcome: "failed",
      message: null,
    });

    stripe.handleNextAction.mockResolvedValue(intent("requires_action"));
    stripe.retrievePaymentIntent.mockRejectedValue(new Error("network"));
    await expect(authenticatePayment(stripe, { ...input, step: "next_action" })).resolves.toEqual({
      outcome: "failed",
      message: null,
    });
  });
});
