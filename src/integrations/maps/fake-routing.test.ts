import { describe, expect, it } from "vitest";

import { checkServiceArea, PROVISIONAL_SERVICE_AREA } from "@/domain/geo/service-area";
import { RouteInputSchema } from "@/domain/pricing/rule";

import { FAKE_PLACES } from "./fake-places";
import { FAKE_ROUTING_PROVIDER, FakeRoutingProvider } from "./fake-routing";
import { RoutingError } from "./routing";

const now = () => new Date("2026-10-12T08:00:00.000Z");
const provider = new FakeRoutingProvider(now);

describe("FakeRoutingProvider (end-to-end tests only)", () => {
  it("returns the fixed road leg between two test places, with their coordinates", async () => {
    const route = await provider.computeRoute({
      origin: { placeId: "e2e-place-opera" },
      destination: { placeId: "e2e-place-cdg-t2" },
    });
    expect(route).toEqual({
      route: {
        distanceMeters: 34_200,
        durationSeconds: 2_700,
        provider: FAKE_ROUTING_PROVIDER,
        computedAt: "2026-10-12T08:00:00.000Z",
      },
      origin: { lat: 48.871_946, lng: 2.331_601 },
      destination: { lat: 49.004_47, lng: 2.571_04 },
    });
    expect(RouteInputSchema.safeParse(route.route).success).toBe(true);
  });

  it("is symmetric", async () => {
    const back = await provider.computeRoute({
      origin: { placeId: "e2e-place-cdg-t2" },
      destination: { placeId: "e2e-place-opera" },
    });
    expect(back.route.distanceMeters).toBe(34_200);
    expect(back.origin).toEqual({ lat: 49.004_47, lng: 2.571_04 });
  });

  it("has no route for an unknown place, the same place twice or raw coordinates", async () => {
    const requests = [
      { origin: { placeId: "ChIJunknown" }, destination: { placeId: "e2e-place-opera" } },
      { origin: { placeId: "e2e-place-opera" }, destination: { placeId: "e2e-place-opera" } },
      { origin: { lat: 48.87, lng: 2.33 }, destination: { placeId: "e2e-place-opera" } },
    ];
    for (const request of requests) {
      await expect(provider.computeRoute(request)).rejects.toMatchObject({
        code: "ROUTE_UNAVAILABLE",
      });
    }
  });

  it("refuses an invalid request like the real adapter", async () => {
    const error = await provider
      .computeRoute({ origin: { placeId: "" }, destination: { placeId: "e2e-place-opera" } })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RoutingError);
    expect(error).toMatchObject({ code: "INVALID_ROUTE_REQUEST" });
  });

  it("only knows places inside the provisional service area", () => {
    for (const place of FAKE_PLACES) {
      expect(checkServiceArea(place, PROVISIONAL_SERVICE_AREA)).toBe("INSIDE");
      expect(place.placeId).toMatch(/^e2e-/);
    }
  });
});
