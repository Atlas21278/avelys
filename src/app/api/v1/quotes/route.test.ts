import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import { buildPricingSnapshot } from "@/domain/pricing/snapshot";
import { QuoteError, type Quote } from "@/server/quotes/quote";

const quote = vi.fn<(input: unknown) => Promise<Quote>>();
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Only the production wiring (index.ts) is replaced; QuoteError is the real class.
vi.mock("@/server/quotes", async () => {
  const { QuoteError: RealQuoteError } = await import("@/server/quotes/quote");
  return { quote: (input: unknown) => quote(input), QuoteError: RealQuoteError };
});
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const { POST } = await import("./route");

const BODY = {
  origin: { placeId: "test-place-origin", label: "Test origin label" },
  destination: { lat: 49.0097, lng: 2.5479, label: "Test destination label" },
  pickupLocalDateTime: "2026-07-02T14:30",
  passengers: 2,
  luggage: 1,
};

function sampleQuote(): Quote {
  const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 22_345 }));
  const snapshot = buildPricingSnapshot({
    fare,
    quotedAt: new Date("2026-07-01T08:00:00.000Z"),
    inputs: {
      origin: { placeId: "test-place-origin" },
      destination: { lat: 49.0097, lng: 2.5479 },
      pickupLocalDateTime: "2026-07-02T14:30",
      timeZone: "Europe/Paris",
      pickupAt: "2026-07-02T12:30:00.000Z",
      passengers: 2,
      luggage: 1,
    },
  });
  return {
    snapshotId: "a".repeat(64),
    snapshot,
    total: fare.total,
    totalHtCents: null,
    vatCents: null,
    pickupAt: new Date("2026-07-02T12:30:00.000Z"),
    origin: BODY.origin,
    destination: BODY.destination,
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/v1/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

type ErrorBody = { error: { code: string; message: string; correlationId: string } };

function allLogs(): string {
  return JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
}

describe("POST /api/v1/quotes", () => {
  beforeEach(() => {
    quote.mockReset();
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
  });

  it("answers the server-computed price, HT/VAT null, with no-store", async () => {
    quote.mockResolvedValue(sampleQuote());
    const response = await post(BODY, { "x-request-id": "quote-test-0001" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("quote-test-0001");
    expect(await response.json()).toEqual({
      quote: {
        snapshotId: "a".repeat(64),
        currency: "EUR",
        totalTtcCents: 4_852,
        totalHtCents: null,
        vatCents: null,
        distanceMeters: 22_345,
        durationSeconds: 1_200,
        pickupAt: "2026-07-02T12:30:00.000Z",
        pickupLocalDateTime: "2026-07-02T14:30",
        timeZone: "Europe/Paris",
        quotedAt: "2026-07-01T08:00:00.000Z",
        pricingRuleVersion: PROVISIONAL_RULE.version,
      },
    });
    expect(quote).toHaveBeenCalledWith(BODY);
  });

  it("logs the outcome without any place data", async () => {
    quote.mockResolvedValue(sampleQuote());
    await post(BODY);
    const logs = allLogs();
    expect(logs).toContain("quote computed");
    for (const value of ["Test origin label", "test-place-origin", "49.0097", "2.5479"]) {
      expect(logs).not.toContain(value);
    }
  });

  it("refuses a body that is not JSON", async () => {
    const response = await post("{not json");
    const body = (await response.json()) as ErrorBody;
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(quote).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_INPUT", false, 400],
    ["BOOKING_LEAD_TIME_TOO_SHORT", false, 422],
    ["LOCAL_TIME_NONEXISTENT", false, 422],
    ["LOCAL_TIME_AMBIGUOUS", false, 422],
    ["ROUTE_UNAVAILABLE", false, 422],
    ["ROUTE_UNAVAILABLE", true, 503],
    ["NO_ACTIVE_PRICING_RULE", false, 503],
    ["PRICING_UNAVAILABLE", false, 503],
    ["DATABASE_UNAVAILABLE", true, 503],
  ] as const)("maps %s (temporary: %s) to HTTP %i", async (code, temporary, status) => {
    quote.mockRejectedValue(new QuoteError(code, "test_reason", "internal detail", temporary));
    const response = await post(BODY, { "x-request-id": "quote-test-0002" });
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(status);
    expect(Object.keys(body.error).sort()).toEqual(["code", "correlationId", "message"]);
    expect(body.error.code).toBe(code);
    expect(body.error.correlationId).toBe("quote-test-0002");
    expect(body.error.message).not.toContain("internal detail");
    expect(allLogs()).not.toContain("Test origin label");
  });

  it("answers in English when asked to", async () => {
    quote.mockRejectedValue(new QuoteError("BOOKING_LEAD_TIME_TOO_SHORT", "lead_time", "x"));
    const fr = (await (await post(BODY)).json()) as ErrorBody;
    quote.mockRejectedValue(new QuoteError("BOOKING_LEAD_TIME_TOO_SHORT", "lead_time", "x"));
    const en = (await (
      await post(BODY, { "accept-language": "en-GB,en;q=0.9" })
    ).json()) as ErrorBody;
    expect(fr.error.message).toMatch(/Contactez-nous/);
    expect(en.error.message).toMatch(/contact us/);
  });

  it("answers 500 without internal details on an unexpected error", async () => {
    quote.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const response = await post(BODY);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect((JSON.parse(text) as ErrorBody).error.code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("at ");
    expect(log.error).toHaveBeenCalled();
  });

  it("logs only the name of an unexpected error, never its message or stack", async () => {
    const error = new TypeError("Cannot read label of Test origin label (test-place-origin)");
    quote.mockRejectedValue(error);
    await post(BODY);

    expect(log.error).toHaveBeenCalledWith({ errorName: "TypeError" }, "quote failed");
    const logs = allLogs();
    for (const value of ["Test origin label", "test-place-origin", "Cannot read"]) {
      expect(logs).not.toContain(value);
    }
    expect(logs).not.toContain("route.test.ts"); // no stack frame
  });
});
