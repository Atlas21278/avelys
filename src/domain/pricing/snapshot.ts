/**
 * `PricingSnapshot` (ADR-0009, BR-13): the immutable record of how a quote was priced — rule
 * version and configuration, inputs, road route, base fare components and totals. It is copied
 * into the Booking, so that a later `PricingRule` version never alters an existing booking.
 * Pure: no I/O, no clock (the caller supplies `quotedAt`).
 */

import { z } from "zod";

import { CURRENCIES } from "@/lib/money";

import {
  BASE_FARE_SCHEMA_VERSION,
  computeBaseFare,
  EXACT_UNITS_PER_CENT,
  type BaseFare,
} from "./base-fare";
import { PricingError, PricingRuleConfigSchema, RouteInputSchema } from "./rule";

export const PRICING_SNAPSHOT_SCHEMA_VERSION = 1;

const SnapshotLatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Routed point as sent to the routing provider: a place id or coordinates, never both. */
const SnapshotWaypointSchema = z.union([
  z.strictObject({ placeId: z.string().min(1) }),
  SnapshotLatLngSchema,
]);

/**
 * Where the priced road route actually starts and ends, as resolved by the routing provider
 * (VTC-035, VTC-039): the coordinates the price was computed for, and the ones stored on the
 * booking. Dispatch navigates to these, never to the label typed by the customer.
 */
export const PricingSnapshotResolvedPointsSchema = z.strictObject({
  origin: SnapshotLatLngSchema,
  destination: SnapshotLatLngSchema,
});

const exact = z.int().nonnegative();

/**
 * Pricing inputs. Display labels are not pricing inputs and are left out: the booking keeps them
 * in its own columns.
 */
export const PricingSnapshotInputsSchema = z.strictObject({
  origin: SnapshotWaypointSchema,
  destination: SnapshotWaypointSchema,
  /** Wall-clock pickup time as entered, `YYYY-MM-DDTHH:mm`, in `timeZone`. */
  pickupLocalDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timeZone: z.string().min(1),
  /** The same instant in UTC (BR-52). */
  pickupAt: z.iso.datetime(),
  passengers: z.int().positive(),
  luggage: z.int().nonnegative(),
});

export const PricingSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(PRICING_SNAPSHOT_SCHEMA_VERSION),
    /** UTC instant the quote was computed at; the rule is the one active at that instant. */
    quotedAt: z.iso.datetime(),
    inputs: PricingSnapshotInputsSchema,
    rule: PricingRuleConfigSchema,
    route: RouteInputSchema,
    /**
     * Added by VTC-039 without a schema version bump: every new snapshot has it, snapshots
     * stored before it do not and remain valid (schema version 1 is read either way).
     */
    resolvedPoints: PricingSnapshotResolvedPointsSchema.optional(),
    baseFare: z.strictObject({
      schemaVersion: z.literal(BASE_FARE_SCHEMA_VERSION),
      exactUnitsPerCent: z.literal(EXACT_UNITS_PER_CENT),
      components: z.strictObject({
        pickupExact: exact,
        distanceExact: exact,
        meteredExact: exact,
        timeFloorExact: exact.nullable(),
        minimumExact: exact,
      }),
      binding: z.enum(["METERED", "TIME_FLOOR", "MINIMUM"]),
      minimumApplied: z.boolean(),
      timeFloorApplied: z.boolean(),
    }),
    totals: z.strictObject({
      currency: z.enum(CURRENCIES),
      amountBasis: z.literal("TTC"),
      ttcCents: z.int().nonnegative(),
      /** DEC-04 (VAT rate) is open: no HT/VAT split is computed, never an invented rate. */
      htCents: z.null(),
      vatCents: z.null(),
    }),
  })
  .superRefine((snapshot, ctx) => {
    // The snapshot must be exactly what the pure engine produces for its own rule and route:
    // a stored or hand-edited snapshot whose figures disagree is refused.
    let fare: BaseFare;
    try {
      fare = computeBaseFare(snapshot.rule, snapshot.route);
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      ctx.addIssue({ code: "custom", path: ["baseFare"], message: error.code });
      return;
    }
    if (!sameBaseFare(baseFarePart(fare), snapshot.baseFare)) {
      ctx.addIssue({ code: "custom", path: ["baseFare"], message: "BASE_FARE_MISMATCH" });
    }
    if (
      snapshot.totals.ttcCents !== fare.total.amountCents ||
      snapshot.totals.currency !== fare.total.currency
    ) {
      ctx.addIssue({ code: "custom", path: ["totals"], message: "TOTAL_MISMATCH" });
    }
  });

export type PricingSnapshot = z.output<typeof PricingSnapshotSchema>;
export type PricingSnapshotInputs = z.output<typeof PricingSnapshotInputsSchema>;
export type PricingSnapshotResolvedPoints = z.output<typeof PricingSnapshotResolvedPointsSchema>;

function baseFarePart(fare: BaseFare): PricingSnapshot["baseFare"] {
  return {
    schemaVersion: fare.schemaVersion,
    exactUnitsPerCent: fare.exactUnitsPerCent,
    components: { ...fare.components },
    binding: fare.binding,
    minimumApplied: fare.minimumApplied,
    timeFloorApplied: fare.timeFloorApplied,
  };
}

function sameBaseFare(a: PricingSnapshot["baseFare"], b: PricingSnapshot["baseFare"]): boolean {
  const keys = Object.keys(a.components) as (keyof PricingSnapshot["baseFare"]["components"])[];
  return (
    a.schemaVersion === b.schemaVersion &&
    a.exactUnitsPerCent === b.exactUnitsPerCent &&
    a.binding === b.binding &&
    a.minimumApplied === b.minimumApplied &&
    a.timeFloorApplied === b.timeFloorApplied &&
    keys.every((key) => a.components[key] === b.components[key])
  );
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validates a snapshot (e.g. read back from `Booking.pricingSnapshot`). Refuses any snapshot
 * whose base fare or total differs from a recomputation with its own rule and route.
 */
export function parsePricingSnapshot(input: unknown): PricingSnapshot {
  const result = PricingSnapshotSchema.safeParse(input);
  if (!result.success) {
    throw new PricingError(
      "INVALID_PRICING_SNAPSHOT",
      `Invalid pricing snapshot: ${describeIssues(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Builds the snapshot of a base fare computed by `computeBaseFare`, validated by its schema.
 * `resolvedPoints` is required here: only snapshots stored before VTC-039 lack it.
 */
export function buildPricingSnapshot(args: {
  fare: BaseFare;
  inputs: PricingSnapshotInputs;
  resolvedPoints: PricingSnapshotResolvedPoints;
  quotedAt: Date;
}): PricingSnapshot {
  const { fare, inputs, resolvedPoints, quotedAt } = args;
  return parsePricingSnapshot({
    schemaVersion: PRICING_SNAPSHOT_SCHEMA_VERSION,
    quotedAt: quotedAt.toISOString(),
    inputs,
    rule: { ...fare.rule },
    route: { ...fare.route },
    resolvedPoints: {
      origin: { lat: resolvedPoints.origin.lat, lng: resolvedPoints.origin.lng },
      destination: { lat: resolvedPoints.destination.lat, lng: resolvedPoints.destination.lng },
    },
    baseFare: baseFarePart(fare),
    totals: {
      currency: fare.total.currency,
      amountBasis: fare.amountBasis,
      ttcCents: fare.total.amountCents,
      htCents: null,
      vatCents: null,
    },
  });
}
