import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvValidationError, parseServerEnv, type ServerEnv } from "@/lib/env/schema";

const serverEnv = vi.fn<() => ServerEnv>();
const log = { error: vi.fn() };

vi.mock("@/lib/env/server", () => ({ serverEnv: () => serverEnv() }));
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const { publicBookingEnabled, publicQuoteSettings } = await import("./public-booking");

const base = {
  NODE_ENV: "test",
  APP_ENV: "ci",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:5433/avelys",
  BETTER_AUTH_SECRET: "unit-tests-only-placeholder-value-0000",
};

function env(extra: Record<string, string>): ServerEnv {
  return parseServerEnv({ ...base, ...extra });
}

beforeEach(() => {
  serverEnv.mockReset();
  log.error.mockReset();
});

describe("publicQuoteSettings (VTC-046)", () => {
  it("keeps the booking page on its placeholder while the switch is off", () => {
    serverEnv.mockReturnValue(
      env({ NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: "unit-test-browser-placeholder" }),
    );
    expect(publicQuoteSettings()).toEqual({ enabled: false });
    expect(publicBookingEnabled()).toBe(false);
  });

  it("offers the quote with the browser key and the provisional service area", () => {
    serverEnv.mockReturnValue(
      env({
        PUBLIC_BOOKING_ENABLED: "true",
        NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: "unit-test-browser-placeholder",
      }),
    );
    expect(publicQuoteSettings()).toEqual({
      enabled: true,
      mapsBrowserKey: "unit-test-browser-placeholder",
      serviceArea: { south: 41, west: -5.5, north: 51.5, east: 10 },
    });
  });

  it("reports a missing browser key so the page offers contact instead of a quote", () => {
    serverEnv.mockReturnValue(env({ PUBLIC_BOOKING_ENABLED: "true" }));
    expect(publicQuoteSettings()).toMatchObject({ enabled: true, mapsBrowserKey: null });
  });

  it("never hands the server key to the browser", () => {
    serverEnv.mockReturnValue(
      env({ PUBLIC_BOOKING_ENABLED: "true", GOOGLE_MAPS_SERVER_API_KEY: "unit-test-server-only" }),
    );
    expect(JSON.stringify(publicQuoteSettings())).not.toContain("unit-test-server-only");
  });

  it("falls back to the placeholder, without a 500, when the environment is invalid", () => {
    serverEnv.mockImplementation(() => {
      throw new EnvValidationError(["DATABASE_URL (invalid_format)"]);
    });
    expect(publicQuoteSettings()).toEqual({ enabled: false });
    expect(log.error).toHaveBeenCalledWith({ errorName: "EnvValidationError" }, expect.any(String));
  });

  it("does not hide an unexpected error", () => {
    serverEnv.mockImplementation(() => {
      throw new TypeError("bug");
    });
    expect(() => publicQuoteSettings()).toThrow(TypeError);
  });
});
