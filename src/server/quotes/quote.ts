import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { meetsLeadTime } from "@/domain/booking/lead-time";
import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PricingError, type PricingRuleConfig } from "@/domain/pricing/rule";
import {
  buildPricingSnapshot,
  type PricingSnapshot,
  type PricingSnapshotInputs,
} from "@/domain/pricing/snapshot";
import {
  RoutingError,
  type LatLng,
  type ResolvedRoute,
  type RoutingProvider,
  type Waypoint,
} from "@/integrations/maps/routing";
import { PARIS_TIME_ZONE, parseLocalDateTime, resolveLocalDateTime } from "@/lib/dates";
import type { ApiErrorCode } from "@/lib/errors";
import type { Money } from "@/lib/money";
import { databaseUnavailableReason } from "@/server/db-errors";
import { PricingRuleStoreError } from "@/server/pricing/rules";

/**
 * Server quote (VTC-027, Master Spec §8, ADR-0009). Assembles the road route, the pricing rule
 * active now and the pure base fare engine into a validated `PricingSnapshot`. The quote is not
 * persisted: the booking service calls `computeQuote` again before creating a booking (BR-12).
 * No amount is ever read from the input, and no price exists without a road route (BR-51).
 */

/** Display label of a place. Not a pricing input, never logged. */
const LabelSchema = z.string().trim().min(1).max(200);

/** A place chosen by the customer: a Places id or coordinates, plus its display label. */
export const QuotePlaceSchema = z.union([
  z.strictObject({ placeId: z.string().trim().min(1).max(1024), label: LabelSchema }),
  z.strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: LabelSchema,
  }),
]);

/**
 * Quote request. Strict: any unknown key — an amount in particular — is refused (BR-12).
 * No maximum passenger or luggage count is enforced here: it depends on DEC-02 (BR-24).
 */
export const QuoteRequestSchema = z.strictObject({
  origin: QuotePlaceSchema,
  destination: QuotePlaceSchema,
  /** Wall-clock pickup time in Europe/Paris, `YYYY-MM-DDTHH:mm`, without offset. */
  pickupLocalDateTime: z
    .string()
    .refine((value) => parseLocalDateTime(value) !== null, "Invalid local date-time"),
  passengers: z.int().min(1),
  luggage: z.int().min(0),
});

export type QuoteRequest = z.input<typeof QuoteRequestSchema>;
export type QuotePlace = z.output<typeof QuotePlaceSchema>;

export interface QuoteDeps {
  readonly routing: RoutingProvider;
  /** Rule active at an instant; throws `PricingRuleStoreError` when there is none. */
  readonly activePricingRule: (at: Date) => Promise<PricingRuleConfig>;
  readonly now: () => Date;
  /** BR-31, provisional and configurable (`BOOKING_MIN_LEAD_TIME_MINUTES`). */
  readonly minLeadTimeMinutes: number;
}

export type QuoteErrorCode = Extract<
  ApiErrorCode,
  | "INVALID_INPUT"
  | "BOOKING_LEAD_TIME_TOO_SHORT"
  | "LOCAL_TIME_NONEXISTENT"
  | "LOCAL_TIME_AMBIGUOUS"
  | "ROUTE_UNAVAILABLE"
  | "NO_ACTIVE_PRICING_RULE"
  | "PRICING_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
>;

/**
 * No price is produced when this is raised. `reason` is a short technical tag for logs;
 * `temporary` marks a provider-side or database failure (the same request may succeed later). Neither the
 * message nor the reason contains a place, a coordinate or a label.
 */
export class QuoteError extends Error {
  override readonly name = "QuoteError";

  constructor(
    readonly code: QuoteErrorCode,
    readonly reason: string,
    message: string,
    readonly temporary = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type Quote = Readonly<{
  /** SHA-256 of the snapshot JSON: identifies this exact priced quote. */
  snapshotId: string;
  snapshot: PricingSnapshot;
  total: Money;
  /** DEC-04 (VAT) is open: always null, never derived from an invented rate. */
  totalHtCents: null;
  vatCents: null;
  pickupAt: Date;
  origin: QuotePlace;
  destination: QuotePlace;
  /**
   * Where the priced route actually starts and ends, as resolved by the routing provider
   * (VTC-035). The only coordinates a booking may store: never the submitted ones.
   */
  pricedOrigin: LatLng;
  pricedDestination: LatLng;
}>;

function toWaypoint(place: QuotePlace): Waypoint {
  return "placeId" in place ? { placeId: place.placeId } : { lat: place.lat, lng: place.lng };
}

export function pricingSnapshotId(snapshot: PricingSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function resolvePickup(pickupLocalDateTime: string): Date {
  const resolution = resolveLocalDateTime(pickupLocalDateTime, PARIS_TIME_ZONE);
  switch (resolution.kind) {
    case "exact":
      return resolution.instant;
    case "nonexistent":
      throw new QuoteError(
        "LOCAL_TIME_NONEXISTENT",
        "dst_gap",
        "Pickup local time does not exist (daylight saving gap)",
      );
    case "ambiguous":
      throw new QuoteError(
        "LOCAL_TIME_AMBIGUOUS",
        "dst_overlap",
        "Pickup local time is ambiguous (daylight saving overlap)",
      );
    case "invalid":
      throw new QuoteError("INVALID_INPUT", "invalid_local_time", "Invalid pickup local time");
  }
}

async function loadRule(deps: QuoteDeps, at: Date): Promise<PricingRuleConfig> {
  try {
    return await deps.activePricingRule(at);
  } catch (error) {
    if (error instanceof PricingRuleStoreError && error.code === "NO_ACTIVE_PRICING_RULE") {
      throw new QuoteError("NO_ACTIVE_PRICING_RULE", "no_active_rule", error.message, false, {
        cause: error,
      });
    }
    if (error instanceof PricingError) {
      throw new QuoteError("PRICING_UNAVAILABLE", error.code, error.message, false, {
        cause: error,
      });
    }
    const databaseReason = databaseUnavailableReason(error);
    if (databaseReason !== null) {
      // The Prisma message may quote the query: only its code is kept (BR-60).
      throw new QuoteError("DATABASE_UNAVAILABLE", databaseReason, "Database unavailable", true, {
        cause: error,
      });
    }
    throw error;
  }
}

async function loadRoute(
  deps: QuoteDeps,
  origin: Waypoint,
  destination: Waypoint,
): Promise<ResolvedRoute> {
  try {
    return await deps.routing.computeRoute({ origin, destination });
  } catch (error) {
    if (!(error instanceof RoutingError)) throw error;
    const reason = `${error.code}:${error.reason}`;
    switch (error.code) {
      case "ROUTE_UNAVAILABLE":
        throw new QuoteError("ROUTE_UNAVAILABLE", reason, error.message, false, { cause: error });
      case "ROUTING_QUOTA_EXCEEDED":
      case "ROUTING_PROVIDER_ERROR":
        throw new QuoteError("ROUTE_UNAVAILABLE", reason, error.message, true, { cause: error });
      case "INVALID_ROUTE_REQUEST":
        throw new QuoteError("INVALID_INPUT", reason, error.message, false, { cause: error });
    }
  }
}

function priceOf(rule: PricingRuleConfig, route: ResolvedRoute["route"]) {
  try {
    return computeBaseFare(rule, route);
  } catch (error) {
    if (!(error instanceof PricingError)) throw error;
    if (error.code === "ROUTE_UNAVAILABLE" || error.code === "INVALID_ROUTE") {
      throw new QuoteError("ROUTE_UNAVAILABLE", error.code, error.message, false, {
        cause: error,
      });
    }
    throw new QuoteError("PRICING_UNAVAILABLE", error.code, error.message, false, {
      cause: error,
    });
  }
}

/**
 * Computes a quote. Checks run cheapest first: input, local time, lead time, active rule, then
 * the (billed) routing call. Every failure is a `QuoteError`; anything else is a bug.
 */
export async function computeQuote(input: unknown, deps: QuoteDeps): Promise<Quote> {
  const parsed = QuoteRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
      .join("; ");
    throw new QuoteError("INVALID_INPUT", "invalid_request", `Invalid quote request: ${issues}`);
  }
  const request = parsed.data;

  const pickupAt = resolvePickup(request.pickupLocalDateTime);
  const now = deps.now();
  if (!meetsLeadTime(pickupAt, now, deps.minLeadTimeMinutes)) {
    throw new QuoteError(
      "BOOKING_LEAD_TIME_TOO_SHORT",
      "lead_time",
      "Pickup is sooner than the minimum booking lead time",
    );
  }

  // The rule active at the moment of the quote (private pricing doc, "Calcul").
  const rule = await loadRule(deps, now);
  const origin = toWaypoint(request.origin);
  const destination = toWaypoint(request.destination);
  const resolved = await loadRoute(deps, origin, destination);
  const fare = priceOf(rule, resolved.route);

  const inputs: PricingSnapshotInputs = {
    origin,
    destination,
    pickupLocalDateTime: request.pickupLocalDateTime,
    timeZone: PARIS_TIME_ZONE,
    pickupAt: pickupAt.toISOString(),
    passengers: request.passengers,
    luggage: request.luggage,
  };

  let snapshot: PricingSnapshot;
  try {
    snapshot = buildPricingSnapshot({
      fare,
      inputs,
      resolvedPoints: { origin: resolved.origin, destination: resolved.destination },
      quotedAt: now,
    });
  } catch (error) {
    if (!(error instanceof PricingError)) throw error;
    throw new QuoteError("PRICING_UNAVAILABLE", error.code, error.message, false, {
      cause: error,
    });
  }

  return Object.freeze({
    snapshotId: pricingSnapshotId(snapshot),
    snapshot,
    total: fare.total,
    totalHtCents: null,
    vatCents: null,
    pickupAt,
    origin: request.origin,
    destination: request.destination,
    pricedOrigin: { lat: resolved.origin.lat, lng: resolved.origin.lng },
    pricedDestination: { lat: resolved.destination.lat, lng: resolved.destination.lng },
  });
}
