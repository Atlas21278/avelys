/**
 * Pricing rule configuration and road-route input of the base fare (Master Spec §8, ADR-0009).
 * No tariff value lives here: amounts come from a versioned `PricingRule` (BR-01, BR-02).
 */

import { z } from "zod";

import { CURRENCIES, ROUNDING_MODES, type RoundingMode } from "@/lib/money";

import { DomainError } from "../errors";

export const PRICING_RULE_SCHEMA_VERSION = 1;

/**
 * DECISION-003 (A1): nearest cent, halves away from zero, applied once to the total. Used when a
 * rule omits `rounding`; any other mode must be set explicitly on the rule.
 */
export const DEFAULT_PRICING_ROUNDING = "halfUp" as const satisfies RoundingMode;

/** Integer cents within the safe range (BR-10). */
const cents = z.int().nonnegative();
/** Same, strictly positive: a zero here would make the rule meaningless or price at 0 EUR. */
const positiveCents = z.int().positive();

/**
 * Time floor: `perHourCents × duration`, prorated to the second.
 *
 * PROVISIONAL STRUCTURE — DEC-03: neither its shape (hourly rate prorated to the second) nor its
 * granularity is decided yet. Disabled (`null`) by default and must stay so in every real rule
 * until DEC-03 settles it. When enabled, the hourly rate must be positive: a zero floor is
 * expressed as `null`, not as `0`.
 */
export const TimeFloorSchema = z.strictObject({ perHourCents: positiveCents });

/**
 * Structural guarantees only; the amounts themselves are provisional business values (DEC-03)
 * that live in a versioned `PricingRule`, never in code (BR-02).
 *
 * Only `minimumCents` is strictly positive: the base fare is at least the minimum, so no valid
 * rule can produce a 0 EUR fare. `pickupCents` and `perKmCents` may be zero (e.g. a flat fare
 * carried by the minimum); whether such rules are used is a business choice (DEC-03).
 */
export const PricingRuleConfigSchema = z.strictObject({
  schemaVersion: z.literal(PRICING_RULE_SCHEMA_VERSION),
  id: z.string().min(1),
  version: z.int().positive(),
  currency: z.enum(CURRENCIES),
  /** DECISION-003 (B1): rule amounts are TTC; HT/VAT are derived once DEC-04 sets the rate. */
  amountBasis: z.literal("TTC"),
  /** DECISION-003 (A1): applied once, to the total only. Defaults to `halfUp`. */
  rounding: z.enum(ROUNDING_MODES).default(DEFAULT_PRICING_ROUNDING),
  pickupCents: cents,
  perKmCents: cents,
  minimumCents: positiveCents,
  timeFloor: TimeFloorSchema.nullable().default(null),
});

export type PricingRuleConfig = z.output<typeof PricingRuleConfigSchema>;
export type PricingRuleConfigInput = z.input<typeof PricingRuleConfigSchema>;

/**
 * Road route computed server side by the routing provider (never a straight-line distance).
 * `computedAt` is a UTC ISO timestamp supplied by the caller: the domain reads no clock.
 */
export const RouteInputSchema = z.strictObject({
  distanceMeters: z.int().positive(),
  durationSeconds: z.int().nonnegative(),
  provider: z.string().min(1),
  computedAt: z.iso.datetime(),
});

export type RouteInput = z.output<typeof RouteInputSchema>;

export type PricingErrorCode =
  | "ROUTE_UNAVAILABLE"
  | "INVALID_ROUTE"
  | "INVALID_PRICING_RULE"
  | "INVALID_PRICING_SNAPSHOT"
  | "AMOUNT_OUT_OF_RANGE";

/** No price is ever produced when this is raised (BR-51). Messages carry no personal data. */
export class PricingError extends DomainError {
  override readonly name = "PricingError";

  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
    .join("; ");
}

export function parsePricingRule(input: unknown): PricingRuleConfig {
  const result = PricingRuleConfigSchema.safeParse(input);
  if (!result.success) {
    throw new PricingError(
      "INVALID_PRICING_RULE",
      `Invalid pricing rule: ${describeIssues(result.error)}`,
    );
  }
  return result.data;
}

export function parseRoute(input: unknown): RouteInput {
  if (input === null || input === undefined) {
    throw new PricingError("ROUTE_UNAVAILABLE", "No road route available: no price is computed");
  }
  const result = RouteInputSchema.safeParse(input);
  if (!result.success) {
    throw new PricingError("INVALID_ROUTE", `Invalid road route: ${describeIssues(result.error)}`);
  }
  return result.data;
}
