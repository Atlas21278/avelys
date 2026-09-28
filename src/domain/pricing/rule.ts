/**
 * Pricing rule configuration and road-route input of the base fare (Master Spec §8, ADR-0009).
 * No tariff value lives here: amounts come from a versioned `PricingRule` (BR-01, BR-02).
 */

import { z } from "zod";

import { CURRENCIES, ROUNDING_MODES } from "@/lib/money";

import { DomainError } from "../errors";

export const PRICING_RULE_SCHEMA_VERSION = 1;

/** Integer cents within the safe range (BR-10). */
const cents = z.int().nonnegative();

/**
 * Time floor: `perHourCents × duration`, prorated to the second. Optional and disabled
 * (`null`) by default: its value is not decided yet (DEC-03).
 */
export const TimeFloorSchema = z.strictObject({ perHourCents: cents });

export const PricingRuleConfigSchema = z.strictObject({
  schemaVersion: z.literal(PRICING_RULE_SCHEMA_VERSION),
  id: z.string().min(1),
  version: z.int().positive(),
  currency: z.enum(CURRENCIES),
  /** DECISION-003 (B1): rule amounts are TTC; HT/VAT are derived once DEC-04 sets the rate. */
  amountBasis: z.literal("TTC"),
  /** DECISION-003 (A1): applied once, to the total only. */
  rounding: z.enum(ROUNDING_MODES),
  pickupCents: cents,
  perKmCents: cents,
  minimumCents: cents,
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
  "ROUTE_UNAVAILABLE" | "INVALID_ROUTE" | "INVALID_PRICING_RULE" | "AMOUNT_OUT_OF_RANGE";

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
