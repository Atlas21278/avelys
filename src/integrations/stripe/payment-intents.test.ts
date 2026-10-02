import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStripePaymentIntentGateway,
  PAYMENT_INTENT_LIST_LIMIT,
  PaymentIntentError,
  type PaymentIntentStripeClient,
} from "./payment-intents";

// Fake Stripe client: no network, no key. Ids are fake test values.
const create = vi.fn();
const list = vi.fn();
const retrieve = vi.fn();
const cancel = vi.fn();

const fakeStripe = {
  paymentIntents: { create, list, retrieve, cancel },
} as unknown as PaymentIntentStripeClient;

const gateway = createStripePaymentIntentGateway(fakeStripe);

function paymentIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_Test123",
    object: "payment_intent",
    status: "succeeded",
    amount: 4_500,
    currency: "eur",
    livemode: false,
    customer: "cus_Test123",
    metadata: { bookingRef: "VTC-ABCD2345", attempt: "1" },
    last_payment_error: null,
    ...overrides,
  };
}

const INPUT = {
  customerId: "cus_Test123",
  paymentMethodId: "pm_Test123",
  amountCents: 4_500,
  currency: "EUR",
  bookingRef: "VTC-ABCD2345",
  attempt: 1,
  idempotencyKey: "booking:b1:charge:1",
} as const;

function cardError(code: string, intent: Record<string, unknown> | undefined) {
  return new Stripe.errors.StripeCardError({
    type: "card_error",
    code,
    message: "Card refused",
    ...(intent ? { payment_intent: intent as unknown as Stripe.PaymentIntent } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOffSessionCharge", () => {
  it("creates a confirmed off-session card PaymentIntent with automatic capture", async () => {
    create.mockResolvedValue(paymentIntent());

    const result = await gateway.createOffSessionCharge(INPUT);

    expect(create).toHaveBeenCalledWith(
      {
        amount: 4_500,
        currency: "eur",
        customer: "cus_Test123",
        payment_method: "pm_Test123",
        payment_method_types: ["card"],
        off_session: true,
        confirm: true,
        capture_method: "automatic",
        metadata: { bookingRef: "VTC-ABCD2345", attempt: "1" },
      },
      { idempotencyKey: "booking:b1:charge:1" },
    );
    expect(result).toEqual({
      intent: {
        id: "pi_Test123",
        status: "succeeded",
        amountCents: 4_500,
        currency: "EUR",
        livemode: false,
        customerId: "cus_Test123",
        bookingRef: "VTC-ABCD2345",
        attempt: 1,
        lastPaymentErrorCode: null,
        lastPaymentErrorDeclineCode: null,
      },
      errorCode: null,
      declineCode: null,
    });
  });

  it("sends no description, receipt email or other personal field", async () => {
    create.mockResolvedValue(paymentIntent());
    await gateway.createOffSessionCharge(INPUT);
    const [params] = create.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(params).sort()).toEqual(
      [
        "amount",
        "capture_method",
        "confirm",
        "currency",
        "customer",
        "metadata",
        "off_session",
        "payment_method",
        "payment_method_types",
      ].sort(),
    );
  });

  it("returns authentication_required as a result carrying the PaymentIntent", async () => {
    create.mockRejectedValue(
      cardError(
        "authentication_required",
        paymentIntent({
          status: "requires_payment_method",
          last_payment_error: { code: "authentication_required" },
        }),
      ),
    );

    const result = await gateway.createOffSessionCharge(INPUT);

    expect(result.errorCode).toBe("authentication_required");
    expect(result.intent).toMatchObject({
      id: "pi_Test123",
      status: "requires_payment_method",
      lastPaymentErrorCode: "authentication_required",
    });
  });

  it("returns a declined card as a result", async () => {
    create.mockRejectedValue(
      cardError(
        "card_declined",
        paymentIntent({
          status: "requires_payment_method",
          last_payment_error: { code: "card_declined" },
        }),
      ),
    );
    await expect(gateway.createOffSessionCharge(INPUT)).resolves.toMatchObject({
      errorCode: "card_declined",
      intent: { status: "requires_payment_method" },
    });
  });

  it("returns the decline code of a soft decline asking for authentication", async () => {
    create.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        type: "card_error",
        code: "card_declined",
        decline_code: "authentication_required",
        payment_intent: paymentIntent({
          status: "requires_payment_method",
          last_payment_error: { code: "card_declined", decline_code: "authentication_required" },
        }) as unknown as Stripe.PaymentIntent,
      }),
    );

    const result = await gateway.createOffSessionCharge(INPUT);

    expect(result).toMatchObject({
      errorCode: "card_declined",
      declineCode: "authentication_required",
      intent: {
        lastPaymentErrorCode: "card_declined",
        lastPaymentErrorDeclineCode: "authentication_required",
      },
    });
  });

  it("throws a card error without PaymentIntent", async () => {
    create.mockRejectedValue(cardError("card_declined", undefined));
    await expect(gateway.createOffSessionCharge(INPUT)).rejects.toBeInstanceOf(
      Stripe.errors.StripeCardError,
    );
  });

  it.each([
    ["an API error", new Stripe.errors.StripeAPIError({ type: "api_error", message: "down" })],
    [
      "a connection error",
      new Stripe.errors.StripeConnectionError({ type: "api_error", message: "network" }),
    ],
  ])("throws %s (technical failure, no outcome)", async (_label, error) => {
    create.mockRejectedValue(error);
    await expect(gateway.createOffSessionCharge(INPUT)).rejects.toBe(error);
  });
});

describe("listCustomerPaymentIntents", () => {
  it("lists the Customer's PaymentIntents as summaries", async () => {
    list.mockResolvedValue({
      has_more: false,
      data: [
        paymentIntent({ id: "pi_Second", status: "processing" }),
        paymentIntent({ id: "pi_First", metadata: {} }),
      ],
    });

    const intents = await gateway.listCustomerPaymentIntents("cus_Test123");

    expect(list).toHaveBeenCalledWith({
      customer: "cus_Test123",
      limit: PAYMENT_INTENT_LIST_LIMIT,
    });
    expect(
      intents.map(({ id, status, bookingRef, attempt }) => [id, status, bookingRef, attempt]),
    ).toEqual([
      ["pi_Second", "processing", "VTC-ABCD2345", 1],
      ["pi_First", "succeeded", null, null],
    ]);
  });

  it("refuses a truncated list rather than miss a PaymentIntent", async () => {
    list.mockResolvedValue({ has_more: true, data: [paymentIntent()] });
    await expect(gateway.listCustomerPaymentIntents("cus_Test123")).rejects.toBeInstanceOf(
      PaymentIntentError,
    );
  });
});

describe("retrievePaymentIntent", () => {
  it("reads a PaymentIntent back", async () => {
    retrieve.mockResolvedValue(
      paymentIntent({ customer: { id: "cus_Test123" }, metadata: { attempt: "x" } }),
    );
    await expect(gateway.retrievePaymentIntent("pi_Test123")).resolves.toMatchObject({
      id: "pi_Test123",
      customerId: "cus_Test123",
      bookingRef: null,
      attempt: null,
    });
  });

  it("returns null for a PaymentIntent Stripe does not know", async () => {
    retrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
      }),
    );
    await expect(gateway.retrievePaymentIntent("pi_Unknown1")).resolves.toBeNull();
  });

  it("refuses an id that is not a PaymentIntent id, without calling Stripe", async () => {
    await expect(gateway.retrievePaymentIntent("../customers/cus_1")).rejects.toBeInstanceOf(
      PaymentIntentError,
    );
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("lets a technical failure through", async () => {
    const error = new Stripe.errors.StripeAPIError({ type: "api_error" });
    retrieve.mockRejectedValue(error);
    await expect(gateway.retrievePaymentIntent("pi_Test123")).rejects.toBe(error);
  });
});

describe("cancelPaymentIntent", () => {
  it("cancels as abandoned with the given idempotency key", async () => {
    cancel.mockResolvedValue(paymentIntent({ status: "canceled" }));

    await expect(
      gateway.cancelPaymentIntent("pi_Test123", "booking:b1:cancel:1"),
    ).resolves.toMatchObject({ id: "pi_Test123", status: "canceled", attempt: 1 });
    expect(cancel).toHaveBeenCalledWith(
      "pi_Test123",
      { cancellation_reason: "abandoned" },
      { idempotencyKey: "booking:b1:cancel:1" },
    );
  });

  it("refuses an id that is not a PaymentIntent id, without calling Stripe", async () => {
    await expect(gateway.cancelPaymentIntent("cus_1", "k")).rejects.toBeInstanceOf(
      PaymentIntentError,
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it("lets a Stripe refusal through (e.g. a PaymentIntent that already succeeded)", async () => {
    const error = new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "payment_intent_unexpected_state",
    });
    cancel.mockRejectedValue(error);
    await expect(gateway.cancelPaymentIntent("pi_Test123", "k")).rejects.toBe(error);
  });
});
