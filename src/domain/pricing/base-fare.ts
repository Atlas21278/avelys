/**
 * Base fare (Master Spec §8, ADR-0009): `max(pickup + perKm × km, timeFloor(duration), minimum)`,
 * without surcharge or promotion. Pure: no I/O, no clock, integer arithmetic only (BR-10).
 *
 * DECISION-003 (#61): every term is computed exactly, then a single rounding to the cent is
 * applied to the total, with the mode stored in the rule (A1). Amounts are TTC (B1).
 */

import { divideRounded, money, type Money } from "@/lib/money";

import {
  parsePricingRule,
  parseRoute,
  PricingError,
  type PricingRuleConfig,
  type PricingRuleConfigInput,
  type RouteInput,
} from "./rule";

const METERS_PER_KM = 1_000;
const SECONDS_PER_HOUR = 3_600;

/**
 * Exact sub-cent unit: least common multiple of 1 000 m/km and 3 600 s/h, so that
 * `perKmCents × meters / 1 000` and `perHourCents × seconds / 3 600` are both integers.
 */
export const EXACT_UNITS_PER_CENT = 18_000;
const DISTANCE_FACTOR = EXACT_UNITS_PER_CENT / METERS_PER_KM; // 18
const DURATION_FACTOR = EXACT_UNITS_PER_CENT / SECONDS_PER_HOUR; // 5

export const BASE_FARE_SCHEMA_VERSION = 1;

/** Which term of the `max(...)` sets the price; ties go to the metered fare, then time floor. */
export type BaseFareBinding = "METERED" | "TIME_FLOOR" | "MINIMUM";

/** All values in exact units (`EXACT_UNITS_PER_CENT` per cent), before the single rounding. */
export type BaseFareComponents = Readonly<{
  pickupExact: number;
  distanceExact: number;
  meteredExact: number;
  /** `null` when the time floor is disabled. */
  timeFloorExact: number | null;
  minimumExact: number;
}>;

/** Shape meant to be embedded in the future `PricingSnapshot` (ADR-0009). JSON-serialisable. */
export type BaseFare = Readonly<{
  schemaVersion: typeof BASE_FARE_SCHEMA_VERSION;
  rule: Readonly<PricingRuleConfig>;
  route: Readonly<RouteInput>;
  exactUnitsPerCent: typeof EXACT_UNITS_PER_CENT;
  components: BaseFareComponents;
  binding: BaseFareBinding;
  minimumApplied: boolean;
  timeFloorApplied: boolean;
  amountBasis: PricingRuleConfig["amountBasis"];
  total: Money;
}>;

function checked(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new PricingError(
      "AMOUNT_OUT_OF_RANGE",
      "Fare computation exceeds the safe integer range",
    );
  }
  return value;
}

/**
 * Multiplies safe integers; an overflowing product is never a safe integer, so it is refused
 * instead of silently losing precision.
 */
function mul(a: number, b: number, c = 1): number {
  return checked(checked(a * b) * c);
}

/**
 * Computes the base fare of a road route. `rule` and `route` are revalidated here because they
 * may come from stored JSON. A missing or invalid route raises `PricingError`: no price (BR-51).
 */
export function computeBaseFare(
  ruleInput: PricingRuleConfigInput,
  routeInput: RouteInput | null | undefined,
): BaseFare {
  const rule = parsePricingRule(ruleInput);
  const route = parseRoute(routeInput);

  const pickupExact = mul(rule.pickupCents, EXACT_UNITS_PER_CENT);
  const distanceExact = mul(rule.perKmCents, route.distanceMeters, DISTANCE_FACTOR);
  const meteredExact = checked(pickupExact + distanceExact);
  const timeFloorExact =
    rule.timeFloor === null
      ? null
      : mul(rule.timeFloor.perHourCents, route.durationSeconds, DURATION_FACTOR);
  const minimumExact = mul(rule.minimumCents, EXACT_UNITS_PER_CENT);

  let binding: BaseFareBinding = "METERED";
  let baseExact = meteredExact;
  if (timeFloorExact !== null && timeFloorExact > baseExact) {
    binding = "TIME_FLOOR";
    baseExact = timeFloorExact;
  }
  if (minimumExact > baseExact) {
    binding = "MINIMUM";
    baseExact = minimumExact;
  }

  const totalCents = divideRounded(baseExact, EXACT_UNITS_PER_CENT, rule.rounding);

  return Object.freeze({
    schemaVersion: BASE_FARE_SCHEMA_VERSION,
    rule: Object.freeze({
      ...rule,
      timeFloor: rule.timeFloor === null ? null : Object.freeze({ ...rule.timeFloor }),
    }),
    route: Object.freeze({ ...route }),
    exactUnitsPerCent: EXACT_UNITS_PER_CENT,
    components: Object.freeze({
      pickupExact,
      distanceExact,
      meteredExact,
      timeFloorExact,
      minimumExact,
    }),
    binding,
    minimumApplied: binding === "MINIMUM",
    timeFloorApplied: binding === "TIME_FLOOR",
    amountBasis: rule.amountBasis,
    total: money(totalCents, rule.currency),
  });
}
