import { describe, expect, it, vi } from "vitest";

const serverEnv = vi.fn(() => ({
  GOOGLE_MAPS_SERVER_API_KEY: undefined as string | undefined,
  E2E_FAKE_ROUTING: false,
}));
const warn = vi.fn();

vi.mock("@/lib/env/server", () => ({ serverEnv: () => serverEnv() }));
vi.mock("@/lib/logger", () => ({ logger: () => ({ info: vi.fn(), warn }) }));

const { routingProvider, RoutingError } = await import("./index");

describe("routingProvider", () => {
  it("reads no environment at import or construction time", () => {
    routingProvider();
    expect(serverEnv).not.toHaveBeenCalled();
  });

  it("fails with a typed error at first call when the server key is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const error = await routingProvider()
      .computeRoute({ origin: { placeId: "a" }, destination: { placeId: "b" } })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RoutingError);
    expect(error).toMatchObject({ code: "ROUTING_PROVIDER_ERROR", reason: "not_configured" });
    expect(serverEnv).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("uses the fake routing table only when the end-to-end switch is on (VTC-048)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    serverEnv.mockReturnValueOnce({ GOOGLE_MAPS_SERVER_API_KEY: "unused", E2E_FAKE_ROUTING: true });
    const route = await routingProvider().computeRoute({
      origin: { placeId: "e2e-place-opera" },
      destination: { placeId: "e2e-place-gare-de-lyon" },
    });

    expect(route.route).toMatchObject({ distanceMeters: 4_100, provider: "e2e-fake-routing" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
