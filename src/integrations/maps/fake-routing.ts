import { fakePlace, fakeRoadLeg } from "./fake-places";
import {
  RouteRequestSchema,
  RoutingError,
  type ResolvedRoute,
  type RouteRequest,
  type RoutingProvider,
} from "./routing";

/**
 * Deterministic routing provider of the end-to-end suite (VTC-048). TEST ONLY: selected by
 * `E2E_FAKE_ROUTING=true`, which the environment schema refuses outside APP_ENV `local`/`ci`.
 * It never calls Google and knows only the test places of `fake-places.ts`: a road leg is a
 * fixed table entry, never a straight-line computation (CLAUDE.md rule 4 holds for the fake too).
 * Anything else, coordinates included, has no route: `ROUTE_UNAVAILABLE`, so no price.
 */

export const FAKE_ROUTING_PROVIDER = "e2e-fake-routing";

export class FakeRoutingProvider implements RoutingProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async computeRoute(request: RouteRequest): Promise<ResolvedRoute> {
    const parsed = RouteRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new RoutingError("INVALID_ROUTE_REQUEST", "invalid_request", "Invalid route request");
    }
    const { origin, destination } = parsed.data;
    const from = "placeId" in origin ? fakePlace(origin.placeId) : null;
    const to = "placeId" in destination ? fakePlace(destination.placeId) : null;
    const leg = from && to ? fakeRoadLeg(from.placeId, to.placeId) : null;
    if (!from || !to || !leg) {
      throw new RoutingError("ROUTE_UNAVAILABLE", "no_route", "No road route found");
    }
    return {
      route: {
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
        provider: FAKE_ROUTING_PROVIDER,
        computedAt: this.now().toISOString(),
      },
      origin: { lat: from.lat, lng: from.lng },
      destination: { lat: to.lat, lng: to.lng },
    };
  }
}
