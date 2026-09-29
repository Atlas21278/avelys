import { describe, expect, it } from "vitest";

import { computeBaseFare } from "./base-fare";
import { PROVISIONAL_RULE, route } from "./fixtures";
import { PricingError } from "./rule";
import {
  buildPricingSnapshot,
  parsePricingSnapshot,
  PRICING_SNAPSHOT_SCHEMA_VERSION,
  type PricingSnapshotInputs,
} from "./snapshot";

const INPUTS: PricingSnapshotInputs = {
  origin: { placeId: "test-place-origin" },
  destination: { lat: 49.0097, lng: 2.5479 },
  pickupLocalDateTime: "2026-10-25T03:00",
  timeZone: "Europe/Paris",
  pickupAt: "2026-10-25T02:00:00.000Z",
  passengers: 2,
  luggage: 1,
};
const RESOLVED_POINTS = {
  origin: { lat: 48.8584, lng: 2.2945 },
  destination: { lat: 49.0096, lng: 2.548 },
};
const QUOTED_AT = new Date("2026-10-20T08:00:00.000Z");

function snapshot(distanceMeters = 22_345) {
  const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters }));
  return {
    fare,
    snapshot: buildPricingSnapshot({
      fare,
      inputs: INPUTS,
      resolvedPoints: RESOLVED_POINTS,
      quotedAt: QUOTED_AT,
    }),
  };
}

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof PricingError ? error.code : error;
  }
  return undefined;
}

describe("PricingSnapshot", () => {
  it("records the rule, inputs, route, components and totals of the base fare", () => {
    const { fare, snapshot: built } = snapshot();

    expect(built).toEqual({
      schemaVersion: PRICING_SNAPSHOT_SCHEMA_VERSION,
      quotedAt: "2026-10-20T08:00:00.000Z",
      inputs: INPUTS,
      rule: fare.rule,
      route: fare.route,
      resolvedPoints: RESOLVED_POINTS,
      baseFare: {
        schemaVersion: fare.schemaVersion,
        exactUnitsPerCent: fare.exactUnitsPerCent,
        components: fare.components,
        binding: "METERED",
        minimumApplied: false,
        timeFloorApplied: false,
      },
      // 1 500 c + 22 345 m at 150 c/km = 4 851.75 c -> 4 852 c (DECISION-003 example).
      totals: {
        currency: "EUR",
        amountBasis: "TTC",
        ttcCents: 4_852,
        htCents: null,
        vatCents: null,
      },
    });
    expect(built.totals.ttcCents).toBe(fare.total.amountCents);
  });

  it("round-trips through JSON (as stored in Booking.pricingSnapshot)", () => {
    const { snapshot: built } = snapshot();
    expect(parsePricingSnapshot(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it("still reads a snapshot stored before VTC-039, without resolved points", () => {
    const { snapshot: built } = snapshot();
    const { resolvedPoints, ...legacy } = built;
    expect(resolvedPoints).toEqual(RESOLVED_POINTS);
    const parsed = parsePricingSnapshot(JSON.parse(JSON.stringify(legacy)));
    expect(parsed).toEqual(legacy);
    expect(parsed.resolvedPoints).toBeUndefined();
  });

  it("records a minimum-bound fare", () => {
    const { snapshot: built } = snapshot(1_000);
    expect(built.baseFare.binding).toBe("MINIMUM");
    expect(built.totals.ttcCents).toBe(PROVISIONAL_RULE.minimumCents);
  });

  it("refuses a snapshot whose total differs from the recomputed fare", () => {
    const { snapshot: built } = snapshot();
    const tampered = { ...built, totals: { ...built.totals, ttcCents: built.totals.ttcCents - 1 } };
    expect(codeOf(() => parsePricingSnapshot(tampered))).toBe("INVALID_PRICING_SNAPSHOT");
  });

  it("refuses a snapshot whose components differ from the recomputed fare", () => {
    const { snapshot: built } = snapshot();
    const tampered = {
      ...built,
      baseFare: {
        ...built.baseFare,
        components: { ...built.baseFare.components, pickupExact: 0 },
      },
    };
    expect(codeOf(() => parsePricingSnapshot(tampered))).toBe("INVALID_PRICING_SNAPSHOT");
  });

  it("refuses a snapshot with a HT or VAT amount while DEC-04 is open", () => {
    const { snapshot: built } = snapshot();
    const withVat = { ...built, totals: { ...built.totals, htCents: 4_043, vatCents: 809 } };
    expect(codeOf(() => parsePricingSnapshot(withVat))).toBe("INVALID_PRICING_SNAPSHOT");
  });

  it.each([
    ["an unknown field", (s: object) => ({ ...s, amountCents: 1 })],
    ["another schema version", (s: object) => ({ ...s, schemaVersion: 2 })],
    ["a non-UTC quotedAt", (s: object) => ({ ...s, quotedAt: "2026-10-20T10:00:00+02:00" })],
    [
      "a waypoint with both a place id and coordinates",
      (s: object) => ({
        ...s,
        inputs: { ...INPUTS, origin: { placeId: "p", lat: 48.8, lng: 2.3 } },
      }),
    ],
    [
      "resolved points given as a place id",
      (s: object) => ({
        ...s,
        resolvedPoints: { ...RESOLVED_POINTS, origin: { placeId: "test-place-origin" } },
      }),
    ],
    [
      "a resolved point with an extra label",
      (s: object) => ({
        ...s,
        resolvedPoints: {
          ...RESOLVED_POINTS,
          destination: { ...RESOLVED_POINTS.destination, label: "Test destination" },
        },
      }),
    ],
    [
      "an out-of-range resolved point",
      (s: object) => ({
        ...s,
        resolvedPoints: { ...RESOLVED_POINTS, origin: { lat: 91, lng: 2.29 } },
      }),
    ],
    [
      "a resolved destination missing",
      (s: object) => ({ ...s, resolvedPoints: { origin: RESOLVED_POINTS.origin } }),
    ],
    ["zero passengers", (s: object) => ({ ...s, inputs: { ...INPUTS, passengers: 0 } })],
    ["an invalid route", (s: object) => ({ ...s, route: route({ distanceMeters: 0 }) })],
  ])("refuses %s", (_label, mutate) => {
    const { snapshot: built } = snapshot();
    expect(codeOf(() => parsePricingSnapshot(mutate(built)))).toBe("INVALID_PRICING_SNAPSHOT");
  });

  it("refuses a missing snapshot", () => {
    expect(codeOf(() => parsePricingSnapshot(null))).toBe("INVALID_PRICING_SNAPSHOT");
  });
});
