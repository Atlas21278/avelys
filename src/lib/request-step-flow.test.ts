import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_CONTACT } from "@/lib/booking-request";
import { quoteFingerprint } from "@/lib/booking-quote";
import { money } from "@/lib/money";
import type { RetainedQuote } from "@/lib/quote-step-state";
import {
  createRequestStore,
  startCardSetup,
  submitRequest,
  type CardConfirmation,
  type RequestFlowDeps,
  type RequestStore,
} from "@/lib/request-step-flow";
import { initialRequestStepState } from "@/lib/request-step-state";

const QUOTE_REQUEST = {
  origin: { placeId: "test-place-origin", label: "Test origin" },
  destination: { placeId: "test-place-destination", label: "Test destination" },
  pickupLocalDateTime: "2026-10-25T14:30",
  passengers: 2,
  luggage: 1,
};
const DISPLAY_QUOTE = {
  snapshotId: "a".repeat(64),
  total: money(4852),
  totalHt: null,
  vat: null,
  distanceMeters: 22_345,
  durationSeconds: 1_800,
  pickupAt: "2026-10-25T13:30:00.000Z",
  pickupLocalDateTime: "2026-10-25T14:30",
  timeZone: "Europe/Paris",
  pricingRuleVersion: 3,
};
const QUOTE: RetainedQuote = {
  request: QUOTE_REQUEST,
  quote: DISPLAY_QUOTE,
  fingerprint: quoteFingerprint(QUOTE_REQUEST, DISPLAY_QUOTE),
};

let ids = 0;
let store: RequestStore;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let deps: RequestFlowDeps;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A promise the test resolves later: holds a call "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function fillContact() {
  const field = (field: "name" | "email", value: string) =>
    store.dispatch({ type: "field", field, value, submissionId: `id-${++ids}` });
  field("name", "Guest Test");
  field("email", "Guest@Avelys.test");
  store.dispatch({ type: "terms", accepted: true });
}

const bookingCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/v1/bookings");
const bodyOf = (call: Parameters<typeof fetch>) =>
  JSON.parse(String(call[1]?.body)) as Record<string, unknown>;

async function withCardEntry() {
  fillContact();
  fetchMock.mockResolvedValueOnce(json(200, { paymentSetup: { clientSecret: "seti_1_secret_x" } }));
  await startCardSetup(deps);
  expect(store.getState().card.kind).toBe("entry");
}

const confirmed = (): Promise<CardConfirmation> =>
  Promise.resolve({ ok: true, paymentSetupId: "seti_1" });

beforeEach(() => {
  ids = 0;
  store = createRequestStore(initialRequestStepState("id-0"));
  store.dispatch({ type: "quote", fingerprint: QUOTE.fingerprint, submissionId: "id-quote" });
  fetchMock = vi.fn<typeof fetch>();
  deps = { store, fetch: fetchMock, locale: "fr", newId: () => `id-${++ids}` };
});

describe("startCardSetup", () => {
  it("sends only the normalised email and the submissionId, then shows the Payment Element", async () => {
    await withCardEntry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/payment-setups");
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "guest@avelys.test",
      submissionId: store.getState().submissionId,
    });
    expect(store.getState().card).toEqual({
      kind: "entry",
      email: "guest@avelys.test",
      clientSecret: "seti_1_secret_x",
    });
  });

  it("creates one SetupIntent on a double click", async () => {
    fillContact();
    const answer = deferred<Response>();
    fetchMock.mockReturnValueOnce(answer.promise);
    const first = startCardSetup(deps);
    const second = startCardSetup(deps);
    answer.resolve(json(200, { paymentSetup: { clientSecret: "seti_1_secret_x" } }));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags an invalid email without calling the server", async () => {
    store.dispatch({ type: "field", field: "email", value: "guest@", submissionId: "x" });
    await startCardSetup(deps);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().issues).toEqual(["email"]);
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("offline")), "network"],
    [
      "a Stripe outage",
      () => Promise.resolve(json(503, { error: { code: "PAYMENT_UNAVAILABLE" } })),
      "paymentUnavailable",
    ],
    ["a malformed answer", () => Promise.resolve(json(200, {})), "unavailable"],
  ])("reports %s and lets the visitor try again", async (_label, answer, failure) => {
    fillContact();
    fetchMock.mockImplementationOnce(answer);
    await startCardSetup(deps);
    expect(store.getState()).toMatchObject({ failure, pending: null, card: { kind: "none" } });
  });
});

describe("submitRequest", () => {
  it("validates the contact first: nothing is confirmed nor sent", async () => {
    await withCardEntry();
    store.dispatch({ type: "terms", accepted: false });
    const confirmCard = vi.fn(confirmed);
    await submitRequest(deps, { quote: QUOTE, confirmCard, acceptPrice: false });
    expect(confirmCard).not.toHaveBeenCalled();
    expect(bookingCalls()).toHaveLength(0);
    expect(store.getState().issues).toEqual(["terms"]);
  });

  it("asks for the card when none was entered", async () => {
    fillContact();
    await submitRequest(deps, { quote: QUOTE, confirmCard: null, acceptPrice: false });
    expect(store.getState().failure).toBe("cardMissing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms the card, then sends the SetupIntent id and the displayed total, never card data", async () => {
    await withCardEntry();
    fetchMock.mockResolvedValueOnce(
      json(201, { booking: { reference: "VTC-AB12CD34", status: "REQUESTED" } }),
    );
    await submitRequest(deps, { quote: QUOTE, confirmCard: confirmed, acceptPrice: false });
    const [call] = bookingCalls();
    expect(call).toBeDefined();
    const body = bodyOf(call!);
    expect(body).toMatchObject({
      paymentSetupId: "seti_1",
      displayedTotal: { amountCents: 4852, currency: "EUR" },
      termsAccepted: true,
      customer: { name: "Guest Test", email: "guest@avelys.test", locale: "fr" },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(store.getState().reference).toBe("VTC-AB12CD34");
  });

  it("sends one request on a double click (button and state both guard)", async () => {
    await withCardEntry();
    const card = deferred<CardConfirmation>();
    const confirmCard = vi.fn(() => card.promise);
    const answer = deferred<Response>();
    fetchMock.mockReturnValueOnce(answer.promise);
    const first = submitRequest(deps, { quote: QUOTE, confirmCard, acceptPrice: false });
    const second = submitRequest(deps, { quote: QUOTE, confirmCard, acceptPrice: false });
    expect(store.getState().pending).toBe("submit");
    card.resolve({ ok: true, paymentSetupId: "seti_1" });
    await vi.waitFor(() => expect(bookingCalls()).toHaveLength(1));
    const third = submitRequest(deps, { quote: QUOTE, confirmCard, acceptPrice: false });
    answer.resolve(json(201, { booking: { reference: "VTC-AB12CD34", status: "REQUESTED" } }));
    await Promise.all([first, second, third]);
    expect(confirmCard).toHaveBeenCalledTimes(1);
    expect(bookingCalls()).toHaveLength(1);
  });

  it("retries after a network error with the same SetupIntent, without confirming the card again", async () => {
    await withCardEntry();
    const confirmCard = vi.fn(confirmed);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await submitRequest(deps, { quote: QUOTE, confirmCard, acceptPrice: false });
    expect(store.getState().failure).toBe("network");

    fetchMock.mockResolvedValueOnce(
      json(200, { booking: { reference: "VTC-AB12CD34", status: "REQUESTED" } }),
    );
    await submitRequest(deps, { quote: QUOTE, confirmCard, acceptPrice: false });
    expect(confirmCard).toHaveBeenCalledTimes(1);
    const [first, second] = bookingCalls();
    expect(bodyOf(second!)).toEqual(bodyOf(first!));
    expect(store.getState().reference).toBe("VTC-AB12CD34");
  });

  it("on PRICE_CHANGED shows the new price, then resends it with the same SetupIntent once confirmed", async () => {
    await withCardEntry();
    fetchMock.mockResolvedValueOnce(
      json(409, {
        error: { code: "PRICE_CHANGED", message: "m", correlationId: "c" },
        total: { amountCents: 5100, currency: "EUR" },
      }),
    );
    await submitRequest(deps, { quote: QUOTE, confirmCard: confirmed, acceptPrice: false });
    expect(store.getState()).toMatchObject({ failure: "priceChanged", priceChange: money(5100) });

    // Without the explicit confirmation, nothing is sent.
    await submitRequest(deps, { quote: QUOTE, confirmCard: confirmed, acceptPrice: false });
    expect(bookingCalls()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(
      json(201, { booking: { reference: "VTC-AB12CD34", status: "REQUESTED" } }),
    );
    await submitRequest(deps, { quote: QUOTE, confirmCard: confirmed, acceptPrice: true });
    const [first, second] = bookingCalls();
    expect(bodyOf(second!)).toMatchObject({
      paymentSetupId: bodyOf(first!).paymentSetupId,
      displayedTotal: { amountCents: 5100, currency: "EUR" },
    });
    expect(store.getState().reference).toBe("VTC-AB12CD34");
  });

  it("sends nothing when Stripe.js refuses the card, and shows Stripe's message", async () => {
    await withCardEntry();
    await submitRequest(deps, {
      quote: QUOTE,
      confirmCard: () => Promise.resolve({ ok: false, message: "Votre carte a été refusée." }),
      acceptPrice: false,
    });
    expect(bookingCalls()).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      cardMessage: "Votre carte a été refusée.",
      pending: null,
    });
  });

  it("treats a throwing Stripe.js as a generic card failure", async () => {
    await withCardEntry();
    await submitRequest(deps, {
      quote: QUOTE,
      confirmCard: () => Promise.reject(new Error("stripe.js")),
      acceptPrice: false,
    });
    expect(store.getState().failure).toBe("cardUnexpected");
    expect(bookingCalls()).toHaveLength(0);
  });

  it("goes back to the card step with a new submissionId on PAYMENT_METHOD_REQUIRED", async () => {
    await withCardEntry();
    const before = store.getState().submissionId;
    fetchMock.mockResolvedValueOnce(json(422, { error: { code: "PAYMENT_METHOD_REQUIRED" } }));
    await submitRequest(deps, { quote: QUOTE, confirmCard: confirmed, acceptPrice: false });
    expect(store.getState()).toMatchObject({ failure: "paymentRequired", card: { kind: "none" } });
    expect(store.getState().submissionId).not.toBe(before);
  });

  it("sends nothing for a quote the step is not bound to", async () => {
    await withCardEntry();
    await submitRequest(deps, {
      quote: { ...QUOTE, fingerprint: "other" },
      confirmCard: confirmed,
      acceptPrice: false,
    });
    expect(bookingCalls()).toHaveLength(0);
  });

  it("ignores the answer when the quote changed while the request was in flight", async () => {
    await withCardEntry();
    const answer = deferred<Response>();
    fetchMock.mockReturnValueOnce(answer.promise);
    const pending = submitRequest(deps, {
      quote: QUOTE,
      confirmCard: confirmed,
      acceptPrice: false,
    });
    await vi.waitFor(() => expect(bookingCalls()).toHaveLength(1));
    store.dispatch({ type: "quote", fingerprint: "fp-new", submissionId: "id-new" });
    answer.resolve(json(201, { booking: { reference: "VTC-OLD", status: "REQUESTED" } }));
    await pending;
    expect(store.getState()).toMatchObject({ reference: null, card: { kind: "none" } });
  });
});

describe("store", () => {
  it("notifies subscribers only on a real change", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.dispatch({ type: "quote", fingerprint: QUOTE.fingerprint, submissionId: "same" });
    expect(listener).not.toHaveBeenCalled();
    store.dispatch({ type: "field", field: "name", value: "x", submissionId: "y" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("starts from an empty contact", () => {
    expect(initialRequestStepState("id").contact).toEqual(EMPTY_CONTACT);
  });
});
