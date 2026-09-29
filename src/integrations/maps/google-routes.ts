import "server-only";

import { z } from "zod";

import {
  checkServiceArea,
  PROVISIONAL_SERVICE_AREA,
  type ServiceArea,
} from "@/domain/geo/service-area";
import { RouteInputSchema } from "@/domain/pricing/rule";

import {
  LatLngSchema,
  RouteRequestSchema,
  RoutingError,
  type ResolvedRoute,
  type RouteRequest,
  type RoutingLogger,
  type RoutingProvider,
  type Waypoint,
} from "./routing";

/**
 * Google Routes API adapter (ADR-0010), `directions/v2:computeRoutes` over plain `fetch`.
 * Server only: the key never leaves the server and is never logged. Only the code, the HTTP
 * status, the latency and the attempt number are logged — never an address, a coordinate or a
 * place id (BR-60).
 */

export const GOOGLE_ROUTES_PROVIDER = "google-routes";
export const GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
/**
 * Distance, duration and the resolved start/end points of the single leg (VTC-035): the stored
 * booking coordinates are the ones the route was priced for. No traffic, toll or polyline field,
 * which would move the request to a more expensive SKU.
 */
export const GOOGLE_ROUTES_FIELD_MASK =
  "routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation";

/**
 * `TRAFFIC_UNAWARE` is the cheapest option (Essentials SKU); the traffic-aware ones are billed
 * as Pro (DEC-17, Maps budget still open).
 */
export const ROUTING_PREFERENCES = [
  "TRAFFIC_UNAWARE",
  "TRAFFIC_AWARE",
  "TRAFFIC_AWARE_OPTIMAL",
] as const;
export type RoutingPreference = (typeof ROUTING_PREFERENCES)[number];

/** Technical defaults, configurable per instance. Not business values. */
export const GOOGLE_ROUTES_DEFAULTS = {
  timeoutMs: 5_000,
  maxAttempts: 2,
  retryDelayMs: 250,
  routingPreference: "TRAFFIC_UNAWARE",
} as const satisfies {
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  routingPreference: RoutingPreference;
};

export interface GoogleRoutesOptions {
  /** Read on each call so that a missing key fails at first use, never at build time. */
  apiKey: () => string | undefined;
  logger: RoutingLogger;
  fetch?: typeof fetch;
  /** Clock for `computedAt`. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt timeout. A timed-out attempt is not retried (bounded quote latency). */
  timeoutMs?: number;
  /** Total attempts, including the first. Only network errors and 5xx are retried. */
  maxAttempts?: number;
  /** Linear backoff: `retryDelayMs × attempt` before the next attempt. */
  retryDelayMs?: number;
  routingPreference?: RoutingPreference;
  /**
   * Broad area every resolved end point must fall in (VTC-039), read on each call like the key.
   * Defaults to `PROVISIONAL_SERVICE_AREA`. A point outside it, or at (0, 0), gets no price.
   */
  serviceArea?: () => ServiceArea;
}

/** A `google.type.LatLng`; proto3 omits zero values, so an absent axis means 0. */
const GoogleLocationSchema = z.object({
  latLng: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
});

/** Only the fields requested by the field mask; extra fields are tolerated. */
const ComputeRoutesResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        // proto3 omits zero values: an absent distance means 0 metres.
        distanceMeters: z.int().nonnegative().optional(),
        duration: z.string().regex(/^\d+(\.\d{1,9})?s$/),
        legs: z
          .array(
            z.object({
              startLocation: GoogleLocationSchema.optional(),
              endLocation: GoogleLocationSchema.optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

type GoogleLocation = z.output<typeof GoogleLocationSchema>;

const GoogleErrorBodySchema = z.object({
  error: z.object({ status: z.string().optional() }).optional(),
});

type AttemptResult =
  { ok: true; route: ResolvedRoute } | { ok: false; error: RoutingError; retryable: boolean };

/** Protobuf duration ("165s", "3.5s") to whole seconds. */
export function parseDurationSeconds(duration: string): number {
  return Math.round(Number(duration.slice(0, -1)));
}

/** A provider location to bounds-checked WGS84 coordinates, or `null` when missing/invalid. */
function toLatLng(location: GoogleLocation | undefined) {
  if (!location) return null;
  const parsed = LatLngSchema.safeParse({
    lat: location.latLng.latitude ?? 0,
    lng: location.latLng.longitude ?? 0,
  });
  return parsed.success ? parsed.data : null;
}

function toGoogleWaypoint(waypoint: Waypoint): Record<string, unknown> {
  if ("placeId" in waypoint) return { placeId: waypoint.placeId };
  return { location: { latLng: { latitude: waypoint.lat, longitude: waypoint.lng } } };
}

function failure(
  code: RoutingError["code"],
  reason: string,
  message: string,
  retryable: boolean,
  httpStatus?: number,
): AttemptResult {
  return { ok: false, error: new RoutingError(code, reason, message, httpStatus), retryable };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GoogleRoutesProvider implements RoutingProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly routingPreference: RoutingPreference;

  constructor(private readonly options: GoogleRoutesOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? GOOGLE_ROUTES_DEFAULTS.timeoutMs;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? GOOGLE_ROUTES_DEFAULTS.maxAttempts);
    this.retryDelayMs = options.retryDelayMs ?? GOOGLE_ROUTES_DEFAULTS.retryDelayMs;
    this.routingPreference = options.routingPreference ?? GOOGLE_ROUTES_DEFAULTS.routingPreference;
  }

  async computeRoute(request: RouteRequest): Promise<ResolvedRoute> {
    const parsed = RouteRequestSchema.safeParse(request);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
        .join("; ");
      throw new RoutingError(
        "INVALID_ROUTE_REQUEST",
        "invalid_request",
        `Invalid route request: ${issues}`,
      );
    }

    const apiKey = this.options.apiKey();
    if (!apiKey) {
      const error = new RoutingError(
        "ROUTING_PROVIDER_ERROR",
        "not_configured",
        "Routing is not configured: GOOGLE_MAPS_SERVER_API_KEY is missing",
      );
      this.options.logger.warn(
        { provider: GOOGLE_ROUTES_PROVIDER, code: error.code, reason: error.reason, attempt: 0 },
        "routing unavailable",
      );
      throw error;
    }

    // Read before the (billed) provider call: a misconfigured area fails without spending one.
    const serviceArea = this.options.serviceArea?.() ?? PROVISIONAL_SERVICE_AREA;

    const body = JSON.stringify({
      origin: toGoogleWaypoint(parsed.data.origin),
      destination: toGoogleWaypoint(parsed.data.destination),
      travelMode: "DRIVE",
      routingPreference: this.routingPreference,
      computeAlternativeRoutes: false,
    });

    for (let attempt = 1; ; attempt += 1) {
      const started = performance.now();
      const result = await this.attempt(apiKey, body, serviceArea);
      const latencyMs = Math.round(performance.now() - started);

      if (result.ok) {
        this.options.logger.info(
          { provider: GOOGLE_ROUTES_PROVIDER, attempt, latencyMs },
          "route computed",
        );
        return result.route;
      }

      const { error } = result;
      const willRetry = result.retryable && attempt < this.maxAttempts;
      this.options.logger.warn(
        {
          provider: GOOGLE_ROUTES_PROVIDER,
          code: error.code,
          reason: error.reason,
          httpStatus: error.httpStatus,
          attempt,
          latencyMs,
          willRetry,
        },
        "routing attempt failed",
      );
      if (!willRetry) throw error;
      await this.sleep(this.retryDelayMs * attempt);
    }
  }

  private async attempt(
    apiKey: string,
    body: string,
    serviceArea: ServiceArea,
  ): Promise<AttemptResult> {
    let response: Response;
    let text: string;
    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      response = await this.fetchFn(GOOGLE_ROUTES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
        },
        body,
        signal,
        cache: "no-store",
      });
      // Read under the same timeout; parsed below so that bad JSON is not mistaken for a timeout.
      text = await response.text();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        return failure("ROUTING_PROVIDER_ERROR", "timeout", "Routing provider timed out", false);
      }
      return failure("ROUTING_PROVIDER_ERROR", "network", "Routing provider unreachable", true);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }

    const status = response.status;
    if (!response.ok) {
      const googleStatus = GoogleErrorBodySchema.safeParse(payload).data?.error?.status;
      if (status === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
        return failure(
          "ROUTING_QUOTA_EXCEEDED",
          "quota_exceeded",
          "Routing provider quota exceeded",
          false,
          status,
        );
      }
      if (status >= 500) {
        return failure(
          "ROUTING_PROVIDER_ERROR",
          "http_5xx",
          `Routing provider error (HTTP ${status})`,
          true,
          status,
        );
      }
      return failure(
        "ROUTING_PROVIDER_ERROR",
        status === 401 || status === 403 ? "forbidden" : "http_4xx",
        `Routing provider rejected the request (HTTP ${status})`,
        false,
        status,
      );
    }

    const parsed = ComputeRoutesResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return failure(
        "ROUTING_PROVIDER_ERROR",
        "invalid_response",
        "Routing provider returned an invalid response",
        false,
        status,
      );
    }

    const first = parsed.data.routes?.[0];
    if (!first) {
      return failure("ROUTE_UNAVAILABLE", "no_route", "No road route found", false, status);
    }
    if (!first.distanceMeters) {
      return failure(
        "ROUTE_UNAVAILABLE",
        "zero_distance",
        "Road route has no distance",
        false,
        status,
      );
    }

    const route = RouteInputSchema.safeParse({
      distanceMeters: first.distanceMeters,
      durationSeconds: parseDurationSeconds(first.duration),
      provider: GOOGLE_ROUTES_PROVIDER,
      computedAt: this.now().toISOString(),
    });
    if (!route.success) {
      return failure(
        "ROUTING_PROVIDER_ERROR",
        "invalid_response",
        "Routing provider returned an invalid route",
        false,
        status,
      );
    }

    // One origin, one destination, no intermediate: exactly one leg. Without its resolved end
    // points the route cannot be stored as priced, so no price is produced (VTC-035).
    const legs = first.legs ?? [];
    const origin = legs.length === 1 ? toLatLng(legs[0]?.startLocation) : null;
    const destination = legs.length === 1 ? toLatLng(legs[0]?.endLocation) : null;
    if (!origin || !destination) {
      return failure(
        "ROUTING_PROVIDER_ERROR",
        "invalid_response",
        "Routing provider returned no resolved end points",
        false,
        status,
      );
    }

    // A point the provider resolved to (0, 0) or far outside the service area is a geocoding or
    // provider error, not a trip: never priced, never stored (VTC-039). Not retried: the same
    // request resolves the same way. The reason names the check, never the point (BR-60).
    for (const point of [origin, destination]) {
      const check = checkServiceArea(point, serviceArea);
      if (check !== "INSIDE") {
        return failure(
          "ROUTING_PROVIDER_ERROR",
          check === "NULL_ISLAND" ? "null_island" : "outside_service_area",
          check === "NULL_ISLAND"
            ? "Routing provider resolved a point to (0, 0)"
            : "Routing provider resolved a point outside the service area",
          false,
          status,
        );
      }
    }
    return { ok: true, route: { route: route.data, origin, destination } };
  }
}
