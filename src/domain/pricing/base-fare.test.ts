import { describe, expect, it } from "vitest";

import { ROUNDING_MODES } from "@/lib/money";

import { DomainError } from "../errors";
import { computeBaseFare, EXACT_UNITS_PER_CENT } from "./base-fare";
import { PROVISIONAL_RULE, route } from "./fixtures";
import {
  DEFAULT_PRICING_ROUNDING,
  parsePricingRule,
  PricingError,
  type PricingErrorCode,
  type PricingRuleConfigInput,
} from "./rule";

function withRule(overrides: Record<string, unknown>): PricingRuleConfigInput {
  return { ...PROVISIONAL_RULE, ...overrides } as PricingRuleConfigInput;
}

function expectPricingError(fn: () => unknown, code: PricingErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PricingError);
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as PricingError).code).toBe(code);
}

describe("computeBaseFare — provisional rule (PROVISIONAL — DEC-03)", () => {
  it("applies the minimum on a short trip", () => {
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 10_000 }));
    // 15.00 + 1.50 x 10 km = 30.00 < 35.00
    expect(fare.total).toEqual({ amountCents: 3_500, currency: "EUR" });
    expect(fare.binding).toBe("MINIMUM");
    expect(fare.minimumApplied).toBe(true);
    expect(fare.timeFloorApplied).toBe(false);
    expect(fare.components.meteredExact).toBe(3_000 * EXACT_UNITS_PER_CENT);
  });

  it("prices a medium trip on pickup plus distance", () => {
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 30_000 }));
    expect(fare.total.amountCents).toBe(6_000);
    expect(fare.binding).toBe("METERED");
    expect(fare.minimumApplied).toBe(false);
    expect(fare.components).toEqual({
      pickupExact: 1_500 * EXACT_UNITS_PER_CENT,
      distanceExact: 4_500 * EXACT_UNITS_PER_CENT,
      meteredExact: 6_000 * EXACT_UNITS_PER_CENT,
      timeFloorExact: null,
      minimumExact: 3_500 * EXACT_UNITS_PER_CENT,
    });
  });

  it("prices a long trip", () => {
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 800_000 }));
    expect(fare.total.amountCents).toBe(121_500);
  });

  it("prices a very long trip exactly (20 000 km)", () => {
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 20_000_000 }));
    expect(fare.total.amountCents).toBe(3_001_500);
  });

  it("rounds once, on the total, half-up (DECISION-003 example: 22 345 m)", () => {
    // 1 500 + 150 x 22.345 = 4 851.75 cents -> 4 852
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 22_345 }));
    expect(fare.components.meteredExact).toBe(4_851.75 * EXACT_UNITS_PER_CENT);
    expect(fare.total.amountCents).toBe(4_852);
  });

  it("rounds an exact half cent up", () => {
    // 1 500 + 150 x 22.310 = 4 846.50 cents -> 4 847
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 22_310 }));
    expect(fare.total.amountCents).toBe(4_847);
  });

  it("rounds just below a half cent down", () => {
    // 1 500 + 150 x 22.329 = 4 849.35 cents -> 4 849
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 22_329 }));
    expect(fare.total.amountCents).toBe(4_849);
  });

  it("charges fractions of a cent for a 1 m difference without cumulative rounding", () => {
    // 150 cents/km = 0.15 cent/m: ten metres add exactly 1.5 cents
    const a = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 30_000 }));
    const b = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 30_010 }));
    expect(b.components.distanceExact - a.components.distanceExact).toBe(
      1.5 * EXACT_UNITS_PER_CENT,
    );
    expect(b.total.amountCents - a.total.amountCents).toBe(2); // 6 001.50 -> 6 002
  });

  it("switches from the minimum to the metered fare at the exact threshold", () => {
    // 13 333 m -> 3 499.95 cents (minimum wins); 13 334 m -> 3 500.10 cents (metered wins)
    // Guards DECISION-003 (A1): terms are compared exactly and only the total is rounded, once.
    // Rounding the distance term or the metered fare first would turn 3 499.95 into 3 500.00
    // and flip the 13 333 m binding to METERED. Do not weaken or "simplify" this test.
    const below = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 13_333 }));
    expect(below.binding).toBe("MINIMUM");
    expect(below.total.amountCents).toBe(3_500);
    const above = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 13_334 }));
    expect(above.binding).toBe("METERED");
    expect(above.minimumApplied).toBe(false);
    expect(above.total.amountCents).toBe(3_500);
  });

  it("does not report the minimum as applied on an exact tie", () => {
    // 15.00 + 2.00 x 10 km = 35.00 = minimum
    const fare = computeBaseFare(withRule({ perKmCents: 200 }), route({ distanceMeters: 10_000 }));
    expect(fare.binding).toBe("METERED");
    expect(fare.minimumApplied).toBe(false);
    expect(fare.total.amountCents).toBe(3_500);
  });

  it("returns the currency and TTC basis of the rule", () => {
    const fare = computeBaseFare(PROVISIONAL_RULE, route());
    expect(fare.total.currency).toBe("EUR");
    expect(fare.amountBasis).toBe("TTC");
  });
});

describe("computeBaseFare — rounding mode comes from the rule", () => {
  it("defaults to halfUp when the rule omits it (DECISION-003)", () => {
    const withoutRounding = Object.fromEntries(
      Object.entries(PROVISIONAL_RULE).filter(([key]) => key !== "rounding"),
    ) as PricingRuleConfigInput;
    expect(withoutRounding).not.toHaveProperty("rounding");
    expect(DEFAULT_PRICING_ROUNDING).toBe("halfUp");
    expect(parsePricingRule(withoutRounding).rounding).toBe("halfUp");
    // 22 310 m -> 4 846.50 cents: halfUp gives 4 847 (halfEven or floor would give 4 846)
    const fare = computeBaseFare(withoutRounding, route({ distanceMeters: 22_310 }));
    expect(fare.rule.rounding).toBe("halfUp");
    expect(fare.total.amountCents).toBe(4_847);
  });

  // 22 310 m -> 4 846.50 cents; 22 345 m -> 4 851.75 cents
  it.each([
    ["halfUp", 22_310, 4_847],
    ["halfEven", 22_310, 4_846],
    ["floor", 22_310, 4_846],
    ["ceil", 22_310, 4_847],
    ["halfUp", 22_345, 4_852],
    ["halfEven", 22_345, 4_852],
    ["floor", 22_345, 4_851],
    ["ceil", 22_345, 4_852],
  ] as const)("%s on %i m gives %i cents", (rounding, distanceMeters, expected) => {
    const fare = computeBaseFare(withRule({ rounding }), route({ distanceMeters }));
    expect(fare.total.amountCents).toBe(expected);
  });

  it("covers every rounding mode of the money helper", () => {
    for (const rounding of ROUNDING_MODES) {
      expect(() => computeBaseFare(withRule({ rounding }), route())).not.toThrow();
    }
  });
});

describe("computeBaseFare — time floor (arbitrary test rates, not business values)", () => {
  it("is disabled by default, whatever the duration", () => {
    const fare = computeBaseFare(PROVISIONAL_RULE, route({ durationSeconds: 36_000 }));
    expect(fare.rule.timeFloor).toBeNull();
    expect(fare.components.timeFloorExact).toBeNull();
    expect(fare.timeFloorApplied).toBe(false);
    expect(fare.total.amountCents).toBe(3_500);
  });

  it("is also disabled when explicitly null", () => {
    const fare = computeBaseFare(withRule({ timeFloor: null }), route());
    expect(fare.timeFloorApplied).toBe(false);
  });

  it("applies when it exceeds the metered fare and the minimum", () => {
    const rule = withRule({ timeFloor: { perHourCents: 6_000 } });
    const fare = computeBaseFare(rule, route({ distanceMeters: 10_000, durationSeconds: 3_600 }));
    expect(fare.binding).toBe("TIME_FLOOR");
    expect(fare.timeFloorApplied).toBe(true);
    expect(fare.minimumApplied).toBe(false);
    expect(fare.total.amountCents).toBe(6_000);
  });

  it("is prorated to the second and rounded once on the total", () => {
    // 10 000 cents/h x 1 300 s = 3 611.11 cents -> 3 611
    const rule = withRule({ timeFloor: { perHourCents: 10_000 } });
    const fare = computeBaseFare(rule, route({ distanceMeters: 10_000, durationSeconds: 1_300 }));
    expect(fare.components.timeFloorExact).toBe(10_000 * 1_300 * 5);
    expect(fare.total.amountCents).toBe(3_611);
  });

  it("does not apply when the metered fare is higher", () => {
    const rule = withRule({ timeFloor: { perHourCents: 6_000 } });
    const fare = computeBaseFare(rule, route({ distanceMeters: 50_000, durationSeconds: 3_600 }));
    expect(fare.binding).toBe("METERED");
    expect(fare.timeFloorApplied).toBe(false);
    expect(fare.components.timeFloorExact).toBe(6_000 * EXACT_UNITS_PER_CENT);
    expect(fare.total.amountCents).toBe(9_000);
  });

  it("lets the minimum win over a lower time floor", () => {
    const rule = withRule({ timeFloor: { perHourCents: 6_000 } });
    const fare = computeBaseFare(rule, route({ distanceMeters: 10_000, durationSeconds: 600 }));
    expect(fare.binding).toBe("MINIMUM");
    expect(fare.timeFloorApplied).toBe(false);
  });

  it("rejects a zero hourly rate: disable the floor with null instead", () => {
    expectPricingError(
      () => computeBaseFare(withRule({ timeFloor: { perHourCents: 0 } }), route()),
      "INVALID_PRICING_RULE",
    );
  });

  it("accepts a zero duration", () => {
    const rule = withRule({ timeFloor: { perHourCents: 6_000 } });
    const fare = computeBaseFare(rule, route({ durationSeconds: 0 }));
    expect(fare.components.timeFloorExact).toBe(0);
  });
});

describe("computeBaseFare — no route, no price (BR-51)", () => {
  it.each([null, undefined])("rejects a missing route (%s)", (missing) => {
    expectPricingError(() => computeBaseFare(PROVISIONAL_RULE, missing), "ROUTE_UNAVAILABLE");
  });

  it.each([
    ["zero distance", { distanceMeters: 0 }],
    ["negative distance", { distanceMeters: -1 }],
    ["fractional distance", { distanceMeters: 1_000.5 }],
    ["NaN distance", { distanceMeters: Number.NaN }],
    ["infinite distance", { distanceMeters: Number.POSITIVE_INFINITY }],
    ["unsafe distance", { distanceMeters: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative duration", { durationSeconds: -1 }],
    ["fractional duration", { durationSeconds: 1.5 }],
    ["empty provider", { provider: "" }],
    ["invalid computedAt", { computedAt: "yesterday" }],
  ])("rejects a route with %s", (_label, overrides) => {
    expectPricingError(() => computeBaseFare(PROVISIONAL_RULE, route(overrides)), "INVALID_ROUTE");
  });

  it("rejects a straight-line or unknown field on the route", () => {
    const withExtra = { ...route(), straightLineMeters: 5_000 };
    expectPricingError(() => computeBaseFare(PROVISIONAL_RULE, withExtra), "INVALID_ROUTE");
  });
});

describe("computeBaseFare — invalid rule", () => {
  it.each([
    ["negative pickup", { pickupCents: -1 }],
    ["fractional per-km price", { perKmCents: 1.5 }],
    ["negative minimum", { minimumCents: -100 }],
    ["zero minimum", { minimumCents: 0 }],
    ["zero per-km price", { perKmCents: 0 }],
    ["negative time floor", { timeFloor: { perHourCents: -1 } }],
    ["null rounding", { rounding: null }],
    ["unsupported currency", { currency: "USD" }],
    ["HT basis (not decided)", { amountBasis: "HT" }],
    ["unknown rounding", { rounding: "commercial" }],
    ["version 0", { version: 0 }],
    ["empty id", { id: "" }],
    ["unknown schema version", { schemaVersion: 2 }],
    ["fractional time floor", { timeFloor: { perHourCents: 10.5 } }],
    ["unknown field", { surchargeCents: 500 }],
  ])("rejects a rule with %s", (_label, overrides) => {
    expectPricingError(() => computeBaseFare(withRule(overrides), route()), "INVALID_PRICING_RULE");
  });

  it("rejects a rule whose amounts are all zero: it would price every trip at 0 EUR", () => {
    const allZero = withRule({
      pickupCents: 0,
      perKmCents: 0,
      minimumCents: 0,
      timeFloor: { perHourCents: 0 },
    });
    expectPricingError(() => computeBaseFare(allZero, route()), "INVALID_PRICING_RULE");
    expectPricingError(() => parsePricingRule(allZero), "INVALID_PRICING_RULE");
  });

  it("accepts a zero pickup: only the minimum and the per-km price must be positive", () => {
    const fare = computeBaseFare(withRule({ pickupCents: 0 }), route({ distanceMeters: 30_000 }));
    expect(fare.total.amountCents).toBe(4_500);
  });

  it("never prices a trip at 0 EUR, even at 1 m with the smallest valid rule", () => {
    const smallest = withRule({ pickupCents: 0, perKmCents: 1, minimumCents: 1 });
    const fare = computeBaseFare(smallest, route({ distanceMeters: 1 }));
    expect(fare.total.amountCents).toBe(1);
  });
});

describe("computeBaseFare — overflow safety", () => {
  it("refuses a computation beyond the safe integer range instead of losing precision", () => {
    const rule = withRule({ perKmCents: 1_000_000_000 });
    expectPricingError(
      () => computeBaseFare(rule, route({ distanceMeters: 1_000_000 })),
      "AMOUNT_OUT_OF_RANGE",
    );
  });

  it("refuses an overflowing time floor", () => {
    const rule = withRule({ timeFloor: { perHourCents: Number.MAX_SAFE_INTEGER } });
    expectPricingError(() => computeBaseFare(rule, route()), "AMOUNT_OUT_OF_RANGE");
  });

  it("refuses an overflowing pickup plus distance sum", () => {
    const rule = withRule({
      pickupCents: Math.floor(Number.MAX_SAFE_INTEGER / EXACT_UNITS_PER_CENT),
    });
    expectPricingError(
      () => computeBaseFare(rule, route({ distanceMeters: 1_000_000 })),
      "AMOUNT_OUT_OF_RANGE",
    );
  });
});

describe("computeBaseFare — determinism and snapshot shape", () => {
  it("returns the same output for the same inputs", () => {
    const r = route({ distanceMeters: 22_345, durationSeconds: 1_800 });
    expect(computeBaseFare(PROVISIONAL_RULE, r)).toEqual(computeBaseFare(PROVISIONAL_RULE, r));
  });

  it("does not mutate its inputs and returns a frozen result", () => {
    const rule = structuredClone(PROVISIONAL_RULE);
    const r = route();
    const ruleCopy = structuredClone(rule);
    const routeCopy = structuredClone(r);
    const fare = computeBaseFare(rule, r);
    expect(rule).toEqual(ruleCopy);
    expect(r).toEqual(routeCopy);
    expect(Object.isFrozen(fare)).toBe(true);
    expect(Object.isFrozen(fare.components)).toBe(true);
    expect(Object.isFrozen(fare.rule)).toBe(true);
    expect(Object.isFrozen(fare.route)).toBe(true);
  });

  it("carries the rule identity, the inputs and survives a JSON round trip", () => {
    const r = route({ distanceMeters: 22_345 });
    const fare = computeBaseFare(PROVISIONAL_RULE, r);
    expect(fare.schemaVersion).toBe(1);
    expect(fare.exactUnitsPerCent).toBe(EXACT_UNITS_PER_CENT);
    expect(fare.rule).toMatchObject({ id: PROVISIONAL_RULE.id, version: 1, schemaVersion: 1 });
    expect(fare.route).toEqual(r);
    expect(JSON.parse(JSON.stringify(fare))).toEqual(fare);
  });
});

describe("computeBaseFare — properties", () => {
  // Deterministic pseudo-random distances (no dependency, reproducible).
  function* distances(count: number): Generator<number> {
    let seed = 42;
    for (let i = 0; i < count; i += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      yield 1 + (seed % 2_000_000);
    }
  }

  it("never goes below the minimum", () => {
    for (const distanceMeters of distances(500)) {
      const fare = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters }));
      expect(fare.total.amountCents).toBeGreaterThanOrEqual(3_500);
      expect(Number.isSafeInteger(fare.total.amountCents)).toBe(true);
    }
  });

  it("is non-decreasing with the distance", () => {
    const sorted = [...distances(500)].sort((a, b) => a - b);
    let previous = 0;
    for (const distanceMeters of sorted) {
      const total = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters })).total.amountCents;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });

  it("is non-decreasing metre by metre around the minimum threshold", () => {
    let previous = 0;
    for (let distanceMeters = 13_000; distanceMeters <= 14_000; distanceMeters += 1) {
      const total = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters })).total.amountCents;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });
});
