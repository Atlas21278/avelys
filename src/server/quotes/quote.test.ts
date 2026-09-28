import { describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import { parsePricingRule, PricingError, type RouteInput } from "@/domain/pricing/rule";
import { parsePricingSnapshot } from "@/domain/pricing/snapshot";
import { RoutingError, type RoutingProvider } from "@/integrations/maps/routing";
import { PricingRuleStoreError } from "@/server/pricing/rules";

import { computeQuote, QuoteError, type QuoteDeps, type QuoteRequest } from "./quote";

// Arbitrary test lead time, not the business value (BR-31 is configured, not coded).
const LEAD_MINUTES = 120;
const NOW = new Date("2026-07-01T08:00:00.000Z");
const RULE = parsePricingRule(PROVISIONAL_RULE);
const ROUTE: RouteInput = route({ distanceMeters: 22_345, durationSeconds: 1_800 });

// 2026-07-02 14:30 in Paris (UTC+2) = 12:30Z.
const REQUEST = {
  origin: { placeId: "test-place-origin", label: "Test origin" },
  destination: { lat: 49.0097, lng: 2.5479, label: "Test destination" },
  pickupLocalDateTime: "2026-07-02T14:30",
  passengers: 2,
  luggage: 1,
} satisfies QuoteRequest;

function deps(overrides: Partial<QuoteDeps> = {}) {
  const computeRoute = vi.fn<RoutingProvider["computeRoute"]>().mockResolvedValue(ROUTE);
  const activePricingRule = vi.fn<QuoteDeps["activePricingRule"]>().mockResolvedValue(RULE);
  const all: QuoteDeps = {
    routing: { computeRoute },
    activePricingRule,
    now: () => NOW,
    minLeadTimeMinutes: LEAD_MINUTES,
    ...overrides,
  };
  return { deps: all, computeRoute, activePricingRule };
}

async function failure(promise: Promise<unknown>): Promise<QuoteError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof QuoteError))
    throw new Error(`expected a QuoteError, got ${String(error)}`);
  return error;
}

describe("computeQuote", () => {
  it("prices exactly like computeBaseFare for the same route and rule", async () => {
    const { deps: d } = deps();
    const quote = await computeQuote(REQUEST, d);

    const expected = computeBaseFare(RULE, ROUTE);
    expect(quote.total).toEqual(expected.total);
    // 1 500 c + 22 345 m at 150 c/km = 4 851.75 c -> 4 852 c (DECISION-003 example).
    expect(quote.total).toEqual({ amountCents: 4_852, currency: "EUR" });
    expect(quote.totalHtCents).toBeNull();
    expect(quote.vatCents).toBeNull();
  });

  it("returns a snapshot valid by its schema, with rule, inputs and route", async () => {
    const { deps: d } = deps();
    const { snapshot, pickupAt } = await computeQuote(REQUEST, d);

    expect(parsePricingSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(snapshot.quotedAt).toBe(NOW.toISOString());
    expect(snapshot.rule).toEqual(RULE);
    expect(snapshot.route).toEqual(ROUTE);
    expect(snapshot.inputs).toEqual({
      origin: { placeId: "test-place-origin" },
      destination: { lat: 49.0097, lng: 2.5479 },
      pickupLocalDateTime: "2026-07-02T14:30",
      timeZone: "Europe/Paris",
      pickupAt: "2026-07-02T12:30:00.000Z",
      passengers: 2,
      luggage: 1,
    });
    expect(pickupAt).toEqual(new Date("2026-07-02T12:30:00.000Z"));
    expect(snapshot.totals).toEqual({
      currency: "EUR",
      amountBasis: "TTC",
      ttcCents: 4_852,
      htCents: null,
      vatCents: null,
    });
  });

  it("uses the rule active at the quote instant and routes without labels", async () => {
    const { deps: d, activePricingRule, computeRoute } = deps();
    await computeQuote(REQUEST, d);

    expect(activePricingRule).toHaveBeenCalledWith(NOW);
    expect(computeRoute).toHaveBeenCalledWith({
      origin: { placeId: "test-place-origin" },
      destination: { lat: 49.0097, lng: 2.5479 },
    });
  });

  it("is reproducible: same inputs, route, rule and clock give the same snapshot id", async () => {
    const first = await computeQuote(REQUEST, deps().deps);
    const second = await computeQuote(structuredClone(REQUEST), deps().deps);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(first.snapshotId).toMatch(/^[0-9a-f]{64}$/);

    const other = await computeQuote({ ...REQUEST, passengers: 3 }, deps().deps);
    expect(other.snapshotId).not.toBe(first.snapshotId);
  });

  describe("invalid input", () => {
    it.each([
      ["an amount sent by the browser", { ...REQUEST, totalTtcCents: 100 }],
      ["an amount inside a place", { ...REQUEST, origin: { ...REQUEST.origin, amount: 1 } }],
      ["a missing destination", { ...REQUEST, destination: undefined }],
      [
        "a place with a place id and coordinates",
        {
          ...REQUEST,
          origin: { placeId: "p", lat: 48.8, lng: 2.3, label: "x" },
        },
      ],
      ["a place without label", { ...REQUEST, origin: { placeId: "p" } }],
      ["a blank label", { ...REQUEST, origin: { placeId: "p", label: "   " } }],
      ["out-of-range coordinates", { ...REQUEST, destination: { lat: 91, lng: 2, label: "x" } }],
      ["an impossible date", { ...REQUEST, pickupLocalDateTime: "2026-02-30T10:00" }],
      ["a date with an offset", { ...REQUEST, pickupLocalDateTime: "2026-07-02T14:30+02:00" }],
      ["zero passengers", { ...REQUEST, passengers: 0 }],
      ["fractional luggage", { ...REQUEST, luggage: 1.5 }],
      ["a string count", { ...REQUEST, passengers: "2" }],
      ["no body", null],
    ])("refuses %s without calling routing", async (_label, input) => {
      const { deps: d, computeRoute, activePricingRule } = deps();
      const error = await failure(computeQuote(input, d));
      expect(error.code).toBe("INVALID_INPUT");
      expect(computeRoute).not.toHaveBeenCalled();
      expect(activePricingRule).not.toHaveBeenCalled();
    });
  });

  describe("daylight saving changes (Europe/Paris)", () => {
    const early = { now: () => new Date("2026-01-01T00:00:00.000Z") };

    it("refuses a nonexistent local time (last Sunday of March)", async () => {
      const { deps: d, computeRoute } = deps(early);
      const error = await failure(
        computeQuote({ ...REQUEST, pickupLocalDateTime: "2026-03-29T02:30" }, d),
      );
      expect(error.code).toBe("LOCAL_TIME_NONEXISTENT");
      expect(computeRoute).not.toHaveBeenCalled();
    });

    it("refuses an ambiguous local time (last Sunday of October)", async () => {
      const { deps: d, computeRoute } = deps(early);
      const error = await failure(
        computeQuote({ ...REQUEST, pickupLocalDateTime: "2026-10-25T02:30" }, d),
      );
      expect(error.code).toBe("LOCAL_TIME_AMBIGUOUS");
      expect(computeRoute).not.toHaveBeenCalled();
    });

    it("converts the times around both changes to UTC", async () => {
      const at = async (local: string) =>
        (await computeQuote({ ...REQUEST, pickupLocalDateTime: local }, deps(early).deps)).pickupAt;
      expect(await at("2026-03-29T01:59")).toEqual(new Date("2026-03-29T00:59:00.000Z"));
      expect(await at("2026-03-29T03:00")).toEqual(new Date("2026-03-29T01:00:00.000Z"));
      expect(await at("2026-10-25T01:59")).toEqual(new Date("2026-10-24T23:59:00.000Z"));
      expect(await at("2026-10-25T03:00")).toEqual(new Date("2026-10-25T02:00:00.000Z"));
    });
  });

  describe("minimum lead time", () => {
    // Pickup 2026-07-02 14:30 Paris = 12:30Z; the limit is LEAD_MINUTES before it.
    const limit = new Date("2026-07-02T10:30:00.000Z");

    it("accepts a quote exactly at the limit", async () => {
      const { deps: d } = deps({ now: () => limit });
      await expect(computeQuote(REQUEST, d)).resolves.toMatchObject({
        total: { amountCents: 4_852 },
      });
    });

    it("refuses a quote just after the limit, without routing", async () => {
      const { deps: d, computeRoute } = deps({ now: () => new Date(limit.getTime() + 1) });
      const error = await failure(computeQuote(REQUEST, d));
      expect(error.code).toBe("BOOKING_LEAD_TIME_TOO_SHORT");
      expect(computeRoute).not.toHaveBeenCalled();
    });

    it("refuses a pickup in the past", async () => {
      const { deps: d } = deps({ minLeadTimeMinutes: 0 });
      const error = await failure(
        computeQuote({ ...REQUEST, pickupLocalDateTime: "2026-06-30T10:00" }, d),
      );
      expect(error.code).toBe("BOOKING_LEAD_TIME_TOO_SHORT");
    });
  });

  describe("routing failures: no price (BR-51)", () => {
    it.each([
      ["ROUTE_UNAVAILABLE", "no_route", false],
      ["ROUTING_PROVIDER_ERROR", "timeout", true],
      ["ROUTING_PROVIDER_ERROR", "not_configured", true],
      ["ROUTING_QUOTA_EXCEEDED", "quota", true],
    ] as const)("maps %s (%s) to ROUTE_UNAVAILABLE", async (code, reason, temporary) => {
      const { deps: d, computeRoute } = deps();
      computeRoute.mockRejectedValue(new RoutingError(code, reason, "routing failed"));
      const error = await failure(computeQuote(REQUEST, d));
      expect(error.code).toBe("ROUTE_UNAVAILABLE");
      expect(error.temporary).toBe(temporary);
      expect(error.reason).toBe(`${code}:${reason}`);
    });

    it("maps a rejected route request to INVALID_INPUT", async () => {
      const { deps: d, computeRoute } = deps();
      computeRoute.mockRejectedValue(
        new RoutingError("INVALID_ROUTE_REQUEST", "invalid_request", "bad waypoints"),
      );
      expect((await failure(computeQuote(REQUEST, d))).code).toBe("INVALID_INPUT");
    });

    it("refuses a zero-distance route", async () => {
      const { deps: d, computeRoute } = deps();
      computeRoute.mockResolvedValue(route({ distanceMeters: 0 }));
      const error = await failure(computeQuote(REQUEST, d));
      expect(error.code).toBe("ROUTE_UNAVAILABLE");
      expect(error.reason).toBe("INVALID_ROUTE");
    });

    it("lets an unexpected error through", async () => {
      const { deps: d, computeRoute } = deps();
      const bug = new TypeError("bug");
      computeRoute.mockRejectedValue(bug);
      await expect(computeQuote(REQUEST, d)).rejects.toBe(bug);
    });
  });

  describe("pricing rule failures: no price", () => {
    it("refuses when no rule is active, without routing", async () => {
      const { deps: d, activePricingRule, computeRoute } = deps();
      activePricingRule.mockRejectedValue(
        new PricingRuleStoreError("NO_ACTIVE_PRICING_RULE", "none"),
      );
      expect((await failure(computeQuote(REQUEST, d))).code).toBe("NO_ACTIVE_PRICING_RULE");
      expect(computeRoute).not.toHaveBeenCalled();
    });

    it("refuses when the stored rule is invalid", async () => {
      const { deps: d, activePricingRule } = deps();
      activePricingRule.mockRejectedValue(new PricingError("INVALID_PRICING_RULE", "invalid"));
      const error = await failure(computeQuote(REQUEST, d));
      expect(error.code).toBe("PRICING_UNAVAILABLE");
      expect(error.reason).toBe("INVALID_PRICING_RULE");
    });

    it("refuses an amount beyond the safe integer range", async () => {
      const { deps: d, computeRoute } = deps();
      computeRoute.mockResolvedValue(route({ distanceMeters: Number.MAX_SAFE_INTEGER }));
      const error = await failure(computeQuote(REQUEST, d));
      expect(error.code).toBe("PRICING_UNAVAILABLE");
      expect(error.reason).toBe("AMOUNT_OUT_OF_RANGE");
    });
  });

  it("never puts a label in an error message", async () => {
    const { deps: d, computeRoute } = deps();
    computeRoute.mockRejectedValue(new RoutingError("ROUTE_UNAVAILABLE", "no_route", "no route"));
    const error = await failure(computeQuote(REQUEST, d));
    expect(error.message).not.toContain("Test origin");
    expect(error.message).not.toContain("test-place-origin");
  });
});
