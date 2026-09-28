/**
 * Test fixtures only — never import from application code (enforced by `no-restricted-imports`
 * in `eslint.config.mjs`: importable from `*.test.ts(x)` files only).
 *
 * PROVISIONAL — DEC-03: the amounts below are the provisional starting values of the private
 * pricing document (15 EUR pickup, 1.50 EUR/km, 35 EUR minimum, no time floor). Real values live
 * in a versioned `PricingRule`, never in code (BR-02). Rounding (half-up on the total) and the
 * TTC basis follow DECISION-003 (#61).
 */

import type { PricingRuleConfigInput, RouteInput } from "./rule";

/** PROVISIONAL — DEC-03. */
export const PROVISIONAL_RULE: PricingRuleConfigInput = Object.freeze({
  schemaVersion: 1,
  id: "fixture-provisional-dec-03",
  version: 1,
  currency: "EUR",
  amountBasis: "TTC",
  rounding: "halfUp",
  pickupCents: 1_500,
  perKmCents: 150,
  minimumCents: 3_500,
});

/** Builds a road route; defaults are arbitrary test values, not business values. */
export function route(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    distanceMeters: 10_000,
    durationSeconds: 1_200,
    provider: "test",
    computedAt: "2026-09-28T10:00:00Z",
    ...overrides,
  };
}
