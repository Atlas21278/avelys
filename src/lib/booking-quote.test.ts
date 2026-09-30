import { describe, expect, it } from "vitest";

import { API_ERRORS } from "@/lib/errors";

import {
  buildQuoteRequest,
  formatDistance,
  formatDuration,
  PLACE_LABEL_MAX_LENGTH,
  QUOTE_ERROR_CODES,
  QUOTE_FAILURES,
  quoteFailureOf,
  quoteFingerprint,
  readQuoteResponse,
  type QuoteDraft,
} from "./booking-quote";

const gareDeLyon = { placeId: "place-gare-de-lyon", label: "Gare de Lyon, Paris" };
const cdg = { placeId: "place-cdg-t2", label: "Aéroport CDG Terminal 2" };

const draft: QuoteDraft = {
  pickup: gareDeLyon,
  dropoff: cdg,
  date: "2026-10-25",
  time: "14:30",
  passengers: "2",
  luggage: "1",
};

const serverQuote = {
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
    quotedAt: "2026-09-28T08:00:00.000Z",
    pricingRuleVersion: 3,
  },
};

describe("buildQuoteRequest", () => {
  it("sends the chosen places, the Paris wall-clock time and the counts, never an amount", () => {
    const result = buildQuoteRequest(draft);
    expect(result).toEqual({
      ok: true,
      request: {
        origin: gareDeLyon,
        destination: cdg,
        pickupLocalDateTime: "2026-10-25T14:30",
        passengers: 2,
        luggage: 1,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/cents|amount|price|total/i);
  });

  it("keeps a wall-clock time that falls in a daylight saving change for the server to judge", () => {
    // 02:30 on 2026-03-29 does not exist in Paris: the server answers LOCAL_TIME_NONEXISTENT.
    const result = buildQuoteRequest({ ...draft, date: "2026-03-29", time: "02:30" });
    expect(result.ok && result.request.pickupLocalDateTime).toBe("2026-03-29T02:30");
  });

  it("requires places chosen from the suggestions (free text is not a place)", () => {
    expect(buildQuoteRequest({ ...draft, pickup: null, dropoff: null })).toEqual({
      ok: false,
      issues: ["pickup", "dropoff"],
    });
    expect(buildQuoteRequest({ ...draft, pickup: { placeId: " ", label: "Gare" } })).toEqual({
      ok: false,
      issues: ["pickup"],
    });
  });

  it("trims labels and caps them to the server length", () => {
    const long = { placeId: "p", label: `  ${"x".repeat(PLACE_LABEL_MAX_LENGTH + 20)}  ` };
    const result = buildQuoteRequest({ ...draft, pickup: long });
    expect(result.ok && result.request.origin.label).toHaveLength(PLACE_LABEL_MAX_LENGTH);
  });

  it.each([
    ["date", { date: "" }],
    ["date", { date: "2026-02-30" }],
    ["date", { date: "25/10/2026" }],
    ["time", { time: "" }],
    ["time", { time: "24:00" }],
    ["time", { time: "9:30" }],
    ["passengers", { passengers: "0" }],
    ["passengers", { passengers: "1.5" }],
    ["passengers", { passengers: "" }],
    ["luggage", { luggage: "-1" }],
    ["luggage", { luggage: "abc" }],
  ] as const)("reports an invalid %s (%o)", (field, patch) => {
    expect(buildQuoteRequest({ ...draft, ...patch })).toEqual({ ok: false, issues: [field] });
  });

  it("accepts zero luggage", () => {
    const result = buildQuoteRequest({ ...draft, luggage: "0" });
    expect(result.ok && result.request.luggage).toBe(0);
  });
});

describe("readQuoteResponse", () => {
  it("keeps the server total in integer cents", () => {
    const quote = readQuoteResponse(serverQuote);
    expect(quote).toMatchObject({
      snapshotId: serverQuote.quote.snapshotId,
      total: { amountCents: 4852, currency: "EUR" },
      totalHt: null,
      vat: null,
      distanceMeters: 22_345,
      durationSeconds: 1_800,
      pickupAt: "2026-10-25T13:30:00.000Z",
      timeZone: "Europe/Paris",
    });
  });

  it("exposes HT and VAT only when the server provides them (DEC-04)", () => {
    const quote = readQuoteResponse({
      quote: { ...serverQuote.quote, totalHtCents: 4043, vatCents: 809 },
    });
    expect(quote?.totalHt).toEqual({ amountCents: 4043, currency: "EUR" });
    expect(quote?.vat).toEqual({ amountCents: 809, currency: "EUR" });
  });

  it.each([
    ["no body", null],
    ["an error body", { error: { code: "INTERNAL_ERROR" } }],
    ["a decimal amount", { quote: { ...serverQuote.quote, totalTtcCents: 48.52 } }],
    ["a negative amount", { quote: { ...serverQuote.quote, totalTtcCents: -1 } }],
    ["an unknown currency", { quote: { ...serverQuote.quote, currency: "USD" } }],
    ["a string amount", { quote: { ...serverQuote.quote, totalTtcCents: "4852" } }],
    ["a missing total", { quote: { ...serverQuote.quote, totalTtcCents: undefined } }],
  ])("refuses %s rather than guess a price", (_name, body) => {
    expect(readQuoteResponse(body)).toBeNull();
  });
});

describe("quoteFailureOf", () => {
  const body = (code: string) => ({ error: { code, message: "…", correlationId: "c" } });

  it.each([
    ["BOOKING_LEAD_TIME_TOO_SHORT", 422, "leadTime"],
    ["LOCAL_TIME_NONEXISTENT", 422, "timeNonexistent"],
    ["LOCAL_TIME_AMBIGUOUS", 422, "timeAmbiguous"],
    ["ROUTE_UNAVAILABLE", 422, "noRoute"],
    ["ROUTE_UNAVAILABLE", 503, "unavailable"],
    ["INVALID_INPUT", 400, "invalidRequest"],
    ["NO_ACTIVE_PRICING_RULE", 503, "unavailable"],
    ["PRICING_UNAVAILABLE", 503, "unavailable"],
    ["DATABASE_UNAVAILABLE", 503, "unavailable"],
    ["INTERNAL_ERROR", 500, "unavailable"],
  ] as const)("maps %s (%i) to %s", (code, status, failure) => {
    expect(quoteFailureOf(status, body(code))).toBe(failure);
  });

  it("gives every error code of the quote endpoint a failure message", () => {
    for (const code of QUOTE_ERROR_CODES) {
      expect(API_ERRORS[code], code).toBeDefined();
      expect(QUOTE_FAILURES).toContain(quoteFailureOf(API_ERRORS[code].status, body(code)));
    }
  });

  it("reads unknown codes and malformed bodies as a temporary unavailability", () => {
    expect(quoteFailureOf(502, "<html>Bad gateway</html>")).toBe("unavailable");
    expect(quoteFailureOf(418, body("SOMETHING_NEW"))).toBe("unavailable");
    expect(quoteFailureOf(404, null)).toBe("unavailable");
  });
});

describe("display formatting", () => {
  // ICU versions differ on the space before units (U+00A0 or U+202F): compare with plain spaces.
  const plain = (text: string) => text.replace(/[\s  ]+/g, " ");

  it("formats the road distance in kilometres", () => {
    expect(plain(formatDistance(22_345, "fr"))).toBe("22,3 km");
    expect(plain(formatDistance(22_345, "en"))).toBe("22.3 km");
    expect(plain(formatDistance(500, "en"))).toBe("0.5 km");
  });

  it("formats the duration in hours and minutes, at least one minute", () => {
    expect(plain(formatDuration(1_800, "en"))).toMatch(/^30 mins?$/);
    expect(plain(formatDuration(20, "fr"))).toBe("1 min");
    expect(plain(formatDuration(3_600, "en"))).toBe("1 hr");
    expect(plain(formatDuration(3_900, "fr"))).toBe("1 h 5 min");
  });
});

describe("quoteFingerprint", () => {
  const request = buildQuoteRequest(draft);
  const quote = readQuoteResponse(serverQuote);
  if (!request.ok || !quote) throw new Error("fixture");

  it("does not change when the same trip is re-quoted at the same price", () => {
    const again = readQuoteResponse({ quote: { ...serverQuote.quote, snapshotId: "b".repeat(64) } });
    expect(again && quoteFingerprint(request.request, again)).toBe(
      quoteFingerprint(request.request, quote),
    );
  });

  it.each([
    ["the pickup", { origin: { placeId: "other", label: "Gare du Nord" } }],
    ["the destination label", { destination: { ...cdg, label: "CDG" } }],
    ["the time", { pickupLocalDateTime: "2026-10-25T15:30" }],
    ["the passengers", { passengers: 3 }],
    ["the luggage", { luggage: 2 }],
  ])("changes with %s", (_name, patch) => {
    expect(quoteFingerprint({ ...request.request, ...patch }, quote)).not.toBe(
      quoteFingerprint(request.request, quote),
    );
  });

  it("changes with the price", () => {
    const pricier = readQuoteResponse({ quote: { ...serverQuote.quote, totalTtcCents: 4900 } });
    expect(pricier && quoteFingerprint(request.request, pricier)).not.toBe(
      quoteFingerprint(request.request, quote),
    );
  });
});
