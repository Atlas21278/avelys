/**
 * Routing port (ADR-0010): the quote service asks for a road route without knowing the provider.
 * A route is either a valid road `ResolvedRoute` or a typed `RoutingError`; there is never a
 * straight-line fallback (CLAUDE.md rule 4, BR-51).
 */

import { z } from "zod";

import type { RouteInput } from "@/domain/pricing/rule";

/** WGS84 coordinates, bounds checked. */
export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** A Places identifier (from server-side autocomplete or geocoding). */
export const PlaceIdSchema = z.strictObject({
  placeId: z.string().trim().min(1).max(1024),
});

/** One end of the trip: a `placeId` or coordinates, never both. */
export const WaypointSchema = z.union([PlaceIdSchema, LatLngSchema]);

export const RouteRequestSchema = z.strictObject({
  origin: WaypointSchema,
  destination: WaypointSchema,
});

export type LatLng = z.output<typeof LatLngSchema>;
export type Waypoint = z.output<typeof WaypointSchema>;
export type RouteRequest = z.input<typeof RouteRequestSchema>;

/**
 * A priced road route and the points it actually starts and ends at, as resolved by the
 * provider (VTC-035). A `placeId` is resolved to its location, coordinates are snapped to the
 * road network: these are the coordinates the price was computed for, and the ones stored on a
 * booking — never the coordinates submitted by the browser.
 */
export type ResolvedRoute = Readonly<{
  route: RouteInput;
  origin: LatLng;
  destination: LatLng;
}>;

export interface RoutingProvider {
  /** Road distance, duration and resolved end points between two waypoints, or a `RoutingError`. */
  computeRoute(request: RouteRequest): Promise<ResolvedRoute>;
}

export type RoutingErrorCode =
  /** The provider found no road route (or the waypoints cannot be routed). No price. */
  | "ROUTE_UNAVAILABLE"
  /** Quota or rate limit reached on the provider side. Not retried. */
  | "ROUTING_QUOTA_EXCEEDED"
  /** Provider failure: 5xx, network, timeout, invalid response, missing or rejected key. */
  | "ROUTING_PROVIDER_ERROR"
  /** The caller passed invalid waypoints (validation failed before any provider call). */
  | "INVALID_ROUTE_REQUEST";

/**
 * Typed routing failure. `reason` is a short technical tag for logs and support; the message and
 * the fields never contain an address, a coordinate, a place id or the API key (BR-60).
 */
export class RoutingError extends Error {
  override readonly name = "RoutingError";

  constructor(
    readonly code: RoutingErrorCode,
    readonly reason: string,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** Minimal structured logger contract (satisfied by the pino logger of `src/lib/logger`). */
export interface RoutingLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}
