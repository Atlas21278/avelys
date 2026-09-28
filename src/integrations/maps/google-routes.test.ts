import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_ROUTES_ENDPOINT,
  GOOGLE_ROUTES_FIELD_MASK,
  GoogleRoutesProvider,
  parseDurationSeconds,
  type GoogleRoutesOptions,
} from "./google-routes";
import { RoutingError, type RouteRequest } from "./routing";

// Test-only placeholders: no real key, no real call (fetch is always mocked).
const API_KEY = "test-key-never-real-0000";
const PLACE_ORIGIN = "ChIJ-test-origin-place";
const PLACE_DESTINATION = "ChIJ-test-destination-place";
const NOW = new Date("2026-09-28T10:00:00.000Z");

const byPlace: RouteRequest = {
  origin: { placeId: PLACE_ORIGIN },
  destination: { placeId: PLACE_DESTINATION },
};
const byCoordinates: RouteRequest = {
  origin: { lat: 48.8738, lng: 2.295 },
  destination: { lat: 49.0097, lng: 2.5479 },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Where the provider resolved the waypoints to: deliberately different from the request.
const RESOLVED_START = { lat: 48.8584, lng: 2.2945 };
const RESOLVED_END = { lat: 49.0079, lng: 2.5508 };

const googleLocation = ({ lat, lng }: { lat: number; lng: number }) => ({
  latLng: { latitude: lat, longitude: lng },
});
const leg = (start = RESOLVED_START, end = RESOLVED_END) => ({
  startLocation: googleLocation(start),
  endLocation: googleLocation(end),
});

const ok = (distanceMeters = 31_250, duration = "2280s") =>
  json(200, { routes: [{ distanceMeters, duration, legs: [leg()] }] });

function setup(responses: Array<Response | Error>, overrides: Partial<GoogleRoutesOptions> = {}) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  const logs: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const provider = new GoogleRoutesProvider({
    apiKey: () => API_KEY,
    fetch: fetchMock,
    now: () => NOW,
    sleep,
    logger: {
      info: (fields, message) => logs.push({ level: "info", fields, message }),
      warn: (fields, message) => logs.push({ level: "warn", fields, message }),
    },
    ...overrides,
  });
  return { provider, fetchMock, logs, sleep };
}

async function routingError(promise: Promise<unknown>): Promise<RoutingError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(RoutingError);
  return error as RoutingError;
}

function sentBody(fetchMock: ReturnType<typeof setup>["fetchMock"]): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("GoogleRoutesProvider — success", () => {
  it("computes a road route from place ids with the minimal field mask", async () => {
    const { provider, fetchMock } = setup([ok()]);

    await expect(provider.computeRoute(byPlace)).resolves.toEqual({
      route: {
        distanceMeters: 31_250,
        durationSeconds: 2280,
        provider: "google-routes",
        computedAt: "2026-09-28T10:00:00.000Z",
      },
      origin: RESOLVED_START,
      destination: RESOLVED_END,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(GOOGLE_ROUTES_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
    });
    expect(GOOGLE_ROUTES_FIELD_MASK).toBe(
      "routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation",
    );
    expect(sentBody(fetchMock)).toEqual({
      origin: { placeId: PLACE_ORIGIN },
      destination: { placeId: PLACE_DESTINATION },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
    });
  });

  it("computes a road route from WGS84 coordinates", async () => {
    const { provider, fetchMock } = setup([ok(26_900, "1900s")]);

    const resolved = await provider.computeRoute(byCoordinates);

    expect(resolved.route.distanceMeters).toBe(26_900);
    // The priced end points are the provider's (snapped to the road), not the submitted ones.
    expect(resolved.origin).toEqual(RESOLVED_START);
    expect(resolved.destination).toEqual(RESOLVED_END);
    expect(sentBody(fetchMock)).toMatchObject({
      origin: { location: { latLng: { latitude: 48.8738, longitude: 2.295 } } },
      destination: { location: { latLng: { latitude: 49.0097, longitude: 2.5479 } } },
    });
  });

  it("accepts a configured routing preference", async () => {
    const { provider, fetchMock } = setup([ok()], { routingPreference: "TRAFFIC_AWARE" });
    await provider.computeRoute(byPlace);
    expect(sentBody(fetchMock).routingPreference).toBe("TRAFFIC_AWARE");
  });

  it("converts protobuf durations to whole seconds", async () => {
    expect(parseDurationSeconds("165s")).toBe(165);
    expect(parseDurationSeconds("0s")).toBe(0);
    expect(parseDurationSeconds("3.4s")).toBe(3);
    expect(parseDurationSeconds("3.5s")).toBe(4);
    expect(parseDurationSeconds("59.999999999s")).toBe(60);

    const { provider } = setup([ok(1_000, "90.6s")]);
    expect((await provider.computeRoute(byPlace)).route.durationSeconds).toBe(91);
  });

  it("reads an omitted proto3 zero coordinate as 0", async () => {
    const { provider } = setup([
      json(200, {
        routes: [
          {
            distanceMeters: 1_000,
            duration: "60s",
            legs: [{ startLocation: { latLng: { latitude: 0.5 } }, endLocation: { latLng: {} } }],
          },
        ],
      }),
    ]);
    await expect(provider.computeRoute(byPlace)).resolves.toMatchObject({
      origin: { lat: 0.5, lng: 0 },
      destination: { lat: 0, lng: 0 },
    });
  });
});

describe("GoogleRoutesProvider — resolved end points are required (VTC-035)", () => {
  const routeWith = (extra: Record<string, unknown>) =>
    json(200, { routes: [{ distanceMeters: 1_000, duration: "60s", ...extra }] });

  it.each([
    ["no legs", routeWith({})],
    ["an empty legs array", routeWith({ legs: [] })],
    ["two legs", routeWith({ legs: [leg(), leg()] })],
    [
      "a leg without start location",
      routeWith({ legs: [{ endLocation: googleLocation(RESOLVED_END) }] }),
    ],
    [
      "a leg without end location",
      routeWith({ legs: [{ startLocation: googleLocation(RESOLVED_START) }] }),
    ],
    ["an out-of-range latitude", routeWith({ legs: [leg({ lat: 91, lng: 2 }, RESOLVED_END)] })],
    [
      "a non-numeric longitude",
      routeWith({
        legs: [
          {
            startLocation: { latLng: { latitude: 48.8, longitude: "2.3" } },
            endLocation: googleLocation(RESOLVED_END),
          },
        ],
      }),
    ],
  ])(
    "raises ROUTING_PROVIDER_ERROR on %s: no price without priced points",
    async (_l, response) => {
      const { provider, fetchMock } = setup([response]);
      const error = await routingError(provider.computeRoute(byPlace));
      expect(error.code).toBe("ROUTING_PROVIDER_ERROR");
      expect(error.reason).toBe("invalid_response");
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
});

describe("GoogleRoutesProvider — no route, never a fallback", () => {
  it.each([
    ["an empty response", {}],
    ["an empty routes array", { routes: [] }],
  ])("raises ROUTE_UNAVAILABLE on %s", async (_label, body) => {
    const { provider, fetchMock } = setup([json(200, body)]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error.code).toBe("ROUTE_UNAVAILABLE");
    expect(error.reason).toBe("no_route");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("raises ROUTE_UNAVAILABLE when the route has no distance", async () => {
    const { provider } = setup([json(200, { routes: [{ duration: "0s" }] })]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error.code).toBe("ROUTE_UNAVAILABLE");
    expect(error.reason).toBe("zero_distance");
  });

  it.each([
    ["invalid JSON", new Response("<html>not json</html>", { status: 200 })],
    ["a numeric duration", json(200, { routes: [{ distanceMeters: 1000, duration: 60 }] })],
    ["a negative distance", json(200, { routes: [{ distanceMeters: -5, duration: "60s" }] })],
    ["a fractional distance", json(200, { routes: [{ distanceMeters: 10.5, duration: "60s" }] })],
    ["a non-object body", json(200, ["routes"])],
  ])("raises ROUTING_PROVIDER_ERROR on %s, without retry", async (_label, response) => {
    const { provider, fetchMock } = setup([response]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error.code).toBe("ROUTING_PROVIDER_ERROR");
    expect(error.reason).toBe("invalid_response");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("GoogleRoutesProvider — HTTP errors", () => {
  it("maps 400 to ROUTING_PROVIDER_ERROR without retry", async () => {
    const { provider, fetchMock } = setup([
      json(400, { error: { code: 400, status: "INVALID_ARGUMENT" } }),
    ]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error).toMatchObject({
      code: "ROUTING_PROVIDER_ERROR",
      reason: "http_4xx",
      httpStatus: 400,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps 429 to ROUTING_QUOTA_EXCEEDED without retry", async () => {
    const { provider, fetchMock } = setup([
      json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }),
    ]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error).toMatchObject({ code: "ROUTING_QUOTA_EXCEEDED", httpStatus: 429 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps a 403 RESOURCE_EXHAUSTED to ROUTING_QUOTA_EXCEEDED without retry", async () => {
    const { provider, fetchMock } = setup([
      json(403, { error: { code: 403, status: "RESOURCE_EXHAUSTED" } }),
    ]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error).toMatchObject({ code: "ROUTING_QUOTA_EXCEEDED", httpStatus: 403 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps a 403 PERMISSION_DENIED (rejected key) to ROUTING_PROVIDER_ERROR without retry", async () => {
    const { provider, fetchMock } = setup([
      json(403, { error: { code: 403, status: "PERMISSION_DENIED" } }),
    ]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error).toMatchObject({
      code: "ROUTING_PROVIDER_ERROR",
      reason: "forbidden",
      httpStatus: 403,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a 500 and succeeds on the next attempt", async () => {
    const { provider, fetchMock, sleep } = setup([json(500, {}), ok()]);
    await expect(provider.computeRoute(byPlace)).resolves.toMatchObject({
      route: { distanceMeters: 31_250 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(250);
  });

  it("retries a network error and succeeds on the next attempt", async () => {
    const { provider, fetchMock } = setup([new TypeError("fetch failed"), ok()]);
    await expect(provider.computeRoute(byPlace)).resolves.toMatchObject({
      route: { distanceMeters: 31_250 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails after the bounded number of attempts on repeated 5xx", async () => {
    const { provider, fetchMock, sleep } = setup(
      [json(503, {}), json(500, {}), json(502, {}), ok()],
      { maxAttempts: 3, retryDelayMs: 100 },
    );
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error).toMatchObject({
      code: "ROUTING_PROVIDER_ERROR",
      reason: "http_5xx",
      httpStatus: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("fails after the default two attempts on repeated network errors", async () => {
    const { provider, fetchMock } = setup([new TypeError("a"), new TypeError("b"), ok()]);
    const error = await routingError(provider.computeRoute(byPlace));
    expect(error).toMatchObject({ code: "ROUTING_PROVIDER_ERROR", reason: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GoogleRoutesProvider — timeout", () => {
  it("aborts a slow provider and does not retry it", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        }),
    );
    const { provider } = setup([], { fetch: fetchMock, timeoutMs: 20 });

    const error = await routingError(provider.computeRoute(byPlace));

    expect(error).toMatchObject({ code: "ROUTING_PROVIDER_ERROR", reason: "timeout" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("GoogleRoutesProvider — configuration and input", () => {
  it.each([undefined, ""])(
    "fails clearly at first call when the key is missing (%j), without calling Google",
    async (key) => {
      const { provider, fetchMock } = setup([ok()], { apiKey: () => key });
      const error = await routingError(provider.computeRoute(byPlace));
      expect(error).toMatchObject({ code: "ROUTING_PROVIDER_ERROR", reason: "not_configured" });
      expect(error.message).toContain("GOOGLE_MAPS_SERVER_API_KEY");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an out-of-range latitude", { ...byCoordinates, origin: { lat: 90.5, lng: 2.3 } }],
    ["an out-of-range longitude", { ...byCoordinates, destination: { lat: 48.8, lng: -181 } }],
    ["an empty place id", { ...byPlace, origin: { placeId: "  " } }],
    ["both a place id and coordinates", { ...byPlace, origin: { placeId: "x", lat: 1, lng: 1 } }],
    ["a missing destination", { origin: { placeId: "x" } }],
  ])("rejects %s before any provider call", async (_label, request) => {
    const { provider, fetchMock } = setup([ok()]);
    const error = await routingError(provider.computeRoute(request as RouteRequest));
    expect(error.code).toBe("INVALID_ROUTE_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GoogleRoutesProvider — logs and errors carry no place data nor key (BR-60)", () => {
  it("logs code, status, latency and attempt only", async () => {
    const scenarios: Array<[RouteRequest, Array<Response | Error>]> = [
      [byPlace, [ok()]],
      [byCoordinates, [json(500, {}), ok()]],
      [byPlace, [json(429, { error: { status: "RESOURCE_EXHAUSTED" } })]],
      [byCoordinates, [json(200, { routes: [] })]],
      [byPlace, [new TypeError(`fetch failed for ${PLACE_ORIGIN}`), new TypeError("again")]],
    ];
    const serialized: string[] = [];

    for (const [request, responses] of scenarios) {
      const { provider, logs } = setup(responses);
      const error = await provider.computeRoute(request).then(
        () => undefined,
        (reason: unknown) => reason as RoutingError,
      );
      serialized.push(JSON.stringify(logs));
      if (error) serialized.push(JSON.stringify({ ...error, message: error.message }));

      expect(logs.length).toBeGreaterThan(0);
      for (const { fields } of logs) {
        expect(Object.keys(fields).sort()).toEqual(expect.arrayContaining(["attempt", "provider"]));
        const allowed = [
          "provider",
          "attempt",
          "latencyMs",
          "code",
          "reason",
          "httpStatus",
          "willRetry",
        ];
        expect(Object.keys(fields).every((key) => allowed.includes(key))).toBe(true);
      }
    }

    const output = serialized.join("\n");
    expect(output).toContain('"httpStatus":500');
    expect(output).toContain('"latencyMs"');
    for (const forbidden of [
      API_KEY,
      PLACE_ORIGIN,
      PLACE_DESTINATION,
      "48.8738",
      "2.295",
      "49.0097",
      "2.5479",
      String(RESOLVED_START.lat),
      String(RESOLVED_START.lng),
      String(RESOLVED_END.lat),
      String(RESOLVED_END.lng),
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it("does not echo invalid waypoint values in the error", async () => {
    const { provider } = setup([]);
    const error = await routingError(
      provider.computeRoute({
        origin: { lat: 123.456789, lng: 2 },
        destination: { placeId: PLACE_DESTINATION },
      }),
    );
    expect(error.message).not.toContain("123.456789");
    expect(error.message).not.toContain(PLACE_DESTINATION);
  });
});
