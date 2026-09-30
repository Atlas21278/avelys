import { describe, expect, it } from "vitest";

import { buildQuoteRequest, readQuoteResponse, type QuoteRequestBody } from "./booking-quote";
import {
  draftOf,
  initialQuoteStepState,
  isSubmitting,
  quoteStepReducer,
  retainedQuote,
  type QuoteStepAction,
  type QuoteStepState,
} from "./quote-step-state";

const gareDeLyon = { placeId: "place-gare-de-lyon", label: "Gare de Lyon, Paris" };
const cdg = { placeId: "place-cdg-t2", label: "Aéroport CDG Terminal 2" };

const quote = readQuoteResponse({
  quote: {
    snapshotId: "a".repeat(64),
    currency: "EUR",
    totalTtcCents: 4852,
    totalHtCents: null,
    vatCents: null,
    distanceMeters: 22_345,
    durationSeconds: 1_800,
    pickupAt: "2026-10-25T13:30:00.000Z",
    pickupLocalDateTime: "2026-10-25T14:30",
    timeZone: "Europe/Paris",
    pricingRuleVersion: 3,
  },
})!;

function run(state: QuoteStepState, ...actions: QuoteStepAction[]): QuoteStepState {
  return actions.reduce(quoteStepReducer, state);
}

/** A complete form, both places chosen. */
function filled(): QuoteStepState {
  return run(
    initialQuoteStepState({ date: "2026-10-25", time: "14:30", passengers: 2, luggage: 1 }),
    { type: "placeChosen", field: "pickup", place: gareDeLyon },
    { type: "placeChosen", field: "dropoff", place: cdg },
  );
}

function requestOf(state: QuoteStepState): QuoteRequestBody {
  const built = buildQuoteRequest(draftOf(state));
  if (!built.ok) throw new Error(`incomplete: ${built.issues.join(",")}`);
  return built.request;
}

/** Submits and answers with the quote. */
function quoted(state: QuoteStepState): QuoteStepState {
  const request = requestOf(state);
  return run(
    state,
    { type: "submitted", revision: state.revision },
    { type: "quoted", revision: state.revision, request, quote },
  );
}

describe("initial state", () => {
  it("pre-fills the home search, but its free-text places are not chosen", () => {
    const state = initialQuoteStepState({
      pickup: "Gare de Lyon",
      dropoff: "CDG T2",
      date: "2026-10-25",
      time: "14:30",
      passengers: 3,
      luggage: 2,
    });
    expect(state.pickup).toEqual({ text: "Gare de Lyon", chosen: null });
    expect(state.dropoff).toEqual({ text: "CDG T2", chosen: null });
    expect(state).toMatchObject({
      date: "2026-10-25",
      time: "14:30",
      passengers: "3",
      luggage: "2",
    });
    expect(buildQuoteRequest(draftOf(state))).toEqual({ ok: false, issues: ["pickup", "dropoff"] });
  });

  it("defaults to one passenger and no luggage", () => {
    expect(initialQuoteStepState({})).toMatchObject({ passengers: "1", luggage: "0", date: "" });
  });
});

describe("place selection", () => {
  it("makes a chosen suggestion the place, its label the text", () => {
    const state = filled();
    expect(state.pickup).toEqual({ text: gareDeLyon.label, chosen: gareDeLyon });
    expect(requestOf(state).origin).toEqual(gareDeLyon);
  });

  it("forgets the chosen place as soon as the visitor types again", () => {
    const state = run(filled(), { type: "placeText", field: "pickup", text: "Gare de Lyon, Pari" });
    expect(state.pickup.chosen).toBeNull();
    expect(buildQuoteRequest(draftOf(state))).toEqual({ ok: false, issues: ["pickup"] });
  });

  it("keeps the choice when the same text is echoed back", () => {
    const state = filled();
    expect(run(state, { type: "placeText", field: "pickup", text: gareDeLyon.label })).toBe(state);
  });
});

describe("submission", () => {
  it("disables submitting while the request is in flight and ignores a second submit", () => {
    const state = filled();
    const sent = run(state, { type: "submitted", revision: state.revision });
    expect(isSubmitting(state)).toBe(false);
    expect(isSubmitting(sent)).toBe(true);
    expect(run(sent, { type: "submitted", revision: sent.revision })).toBe(sent);
  });

  it("retains the server quote with the exact request that produced it", () => {
    const state = quoted(filled());
    expect(isSubmitting(state)).toBe(false);
    const retained = retainedQuote(state);
    expect(retained?.quote.total).toEqual({ amountCents: 4852, currency: "EUR" });
    expect(retained?.request).toEqual(requestOf(filled()));
    expect(retained?.fingerprint).toEqual(expect.any(String));
  });

  it("shows a failure and re-enables the button", () => {
    const state = filled();
    const failed = run(
      state,
      { type: "submitted", revision: state.revision },
      { type: "failed", revision: state.revision, failure: "leadTime" },
    );
    expect(failed.outcome).toEqual({ kind: "failure", failure: "leadTime" });
    expect(isSubmitting(failed)).toBe(false);
    expect(retainedQuote(failed)).toBeNull();
  });

  it("records the fields to fix and clears each one once edited", () => {
    const state = run(initialQuoteStepState({}), {
      type: "invalid",
      issues: ["pickup", "dropoff", "date", "time"],
    });
    expect(state.issues).toEqual(["pickup", "dropoff", "date", "time"]);
    const fixed = run(state, { type: "field", field: "date", value: "2026-10-25" });
    expect(fixed.issues).toEqual(["pickup", "dropoff", "time"]);
  });
});

describe("invalidation (the price shown always matches the inputs shown)", () => {
  it.each<[string, QuoteStepAction]>([
    ["the pickup text", { type: "placeText", field: "pickup", text: "Gare du Nord" }],
    ["the destination", { type: "placeChosen", field: "dropoff", place: gareDeLyon }],
    ["the date", { type: "field", field: "date", value: "2026-10-26" }],
    ["the time", { type: "field", field: "time", value: "15:00" }],
    ["the passengers", { type: "field", field: "passengers", value: "3" }],
    ["the luggage", { type: "field", field: "luggage", value: "0" }],
  ])("drops the retained quote when %s changes", (_name, action) => {
    const state = quoted(filled());
    const changed = run(state, action);
    expect(retainedQuote(changed)).toBeNull();
    expect(changed.revision).toBe(state.revision + 1);
  });

  it("keeps the quote when a value is set to what it already is", () => {
    const state = quoted(filled());
    expect(run(state, { type: "field", field: "time", value: "14:30" })).toBe(state);
  });

  it("ignores a response to a request sent before the inputs changed", () => {
    const state = filled();
    const request = requestOf(state);
    const edited = run(
      state,
      { type: "submitted", revision: state.revision },
      { type: "field", field: "time", value: "18:00" },
    );
    expect(isSubmitting(edited)).toBe(false);
    const late = run(edited, { type: "quoted", revision: state.revision, request, quote });
    expect(late).toBe(edited);
    expect(retainedQuote(late)).toBeNull();
    const lateFailure = run(edited, {
      type: "failed",
      revision: state.revision,
      failure: "unavailable",
    });
    expect(lateFailure).toBe(edited);
  });
});
