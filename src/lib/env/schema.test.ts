import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./schema";

const valid = {
  NODE_ENV: "development",
  APP_ENV: "local",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:5433/avelys",
  BETTER_AUTH_SECRET: "unit-tests-only-placeholder-value-0000",
};

const defaults = {
  LOG_LEVEL: "info",
  TRUSTED_PROXIES: [],
  AUTH_SESSION_MAX_AGE_SECONDS: 604_800,
  BOOKING_MIN_LEAD_TIME_MINUTES: 720,
  ROUTING_SERVICE_AREA: { south: 41, west: -5.5, north: 51.5, east: 10 },
};

describe("parseServerEnv", () => {
  it("returns typed values for a valid environment, with defaults", () => {
    expect(parseServerEnv(valid)).toEqual({ ...valid, ...defaults });
  });

  it("ignores unrelated variables", () => {
    expect(parseServerEnv({ ...valid, PATH: "/usr/bin" })).toEqual({ ...valid, ...defaults });
  });

  it("parses trusted proxies as a list of IPs and CIDR ranges", () => {
    expect(
      parseServerEnv({ ...valid, TRUSTED_PROXIES: " 10.0.0.0/8, 192.0.2.10 ,fd00::/8," })
        .TRUSTED_PROXIES,
    ).toEqual(["10.0.0.0/8", "192.0.2.10", "fd00::/8"]);
    expect(parseServerEnv({ ...valid, TRUSTED_PROXIES: "" }).TRUSTED_PROXIES).toEqual([]);
  });

  it("rejects a trusted proxy that is not an IP or a CIDR range", () => {
    for (const value of ["ingress.local", "10.0.0.0/33", "10.0.0.0/8, *"]) {
      expect(() => parseServerEnv({ ...valid, TRUSTED_PROXIES: value })).toThrowError(
        /TRUSTED_PROXIES/,
      );
    }
  });

  it("reads the booking lead time as a positive integer number of minutes", () => {
    const read = (value: string) =>
      parseServerEnv({ ...valid, BOOKING_MIN_LEAD_TIME_MINUTES: value })
        .BOOKING_MIN_LEAD_TIME_MINUTES;
    expect(read("90")).toBe(90);
    expect(read("1")).toBe(1);
    expect(read("")).toBe(720);
    for (const value of ["0", "-1", "1.5", "twelve hours"]) {
      expect(() => read(value)).toThrowError(/BOOKING_MIN_LEAD_TIME_MINUTES/);
    }
  });

  it("reads the session lifetime as a positive integer number of seconds", () => {
    expect(
      parseServerEnv({ ...valid, AUTH_SESSION_MAX_AGE_SECONDS: "3600" })
        .AUTH_SESSION_MAX_AGE_SECONDS,
    ).toBe(3600);
    expect(
      parseServerEnv({ ...valid, AUTH_SESSION_MAX_AGE_SECONDS: "" }).AUTH_SESSION_MAX_AGE_SECONDS,
    ).toBe(604_800);
    for (const value of ["0", "-1", "1.5", "one hour"]) {
      expect(() => parseServerEnv({ ...valid, AUTH_SESSION_MAX_AGE_SECONDS: value })).toThrowError(
        /AUTH_SESSION_MAX_AGE_SECONDS/,
      );
    }
  });

  it("treats the Google Maps server key as optional, empty meaning not configured", () => {
    expect(parseServerEnv(valid).GOOGLE_MAPS_SERVER_API_KEY).toBeUndefined();
    expect(
      parseServerEnv({ ...valid, GOOGLE_MAPS_SERVER_API_KEY: "" }).GOOGLE_MAPS_SERVER_API_KEY,
    ).toBeUndefined();
    expect(
      parseServerEnv({ ...valid, GOOGLE_MAPS_SERVER_API_KEY: "unit-test-placeholder" })
        .GOOGLE_MAPS_SERVER_API_KEY,
    ).toBe("unit-test-placeholder");
    expect(() => parseServerEnv({ ...valid, GOOGLE_MAPS_SERVER_API_KEY: "   " })).toThrowError(
      /GOOGLE_MAPS_SERVER_API_KEY/,
    );
  });

  it("reads the routing service area, defaulting to the provisional metropolitan France box", () => {
    const read = (value: string) =>
      parseServerEnv({ ...valid, ROUTING_SERVICE_AREA: value }).ROUTING_SERVICE_AREA;
    expect(read("48.1,1.4,49.3,3.6")).toEqual({ south: 48.1, west: 1.4, north: 49.3, east: 3.6 });
    expect(read("")).toEqual(defaults.ROUTING_SERVICE_AREA);
    for (const value of ["48.1,1.4,49.3", "49.3,1.4,48.1,3.6", "Île-de-France"]) {
      expect(() => read(value)).toThrowError(/ROUTING_SERVICE_AREA/);
    }
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: "mysql://x@y/z" })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it("names every missing variable", () => {
    expect(() => parseServerEnv({})).toThrowError(EnvValidationError);
    try {
      parseServerEnv({});
    } catch (error) {
      const names = (error as EnvValidationError).variables.join(" ");
      expect(names).toContain("NODE_ENV");
      expect(names).toContain("APP_ENV");
      expect(names).toContain("APP_URL");
      expect(names).toContain("DATABASE_URL");
      expect(names).toContain("BETTER_AUTH_SECRET");
    }
  });

  it("never echoes a rejected value", () => {
    const secretLooking = "sk_live_do_not_print_me";
    let message = "";
    try {
      parseServerEnv({ ...valid, APP_ENV: secretLooking, APP_URL: secretLooking });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/APP_ENV/);
    expect(message).toMatch(/APP_URL/);
    expect(message).not.toContain(secretLooking);
  });

  it("rejects a Better Auth secret shorter than 32 characters", () => {
    expect(() => parseServerEnv({ ...valid, BETTER_AUTH_SECRET: "too-short" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a non-http URL", () => {
    expect(() => parseServerEnv({ ...valid, APP_URL: "ftp://example.com" })).toThrowError(
      /APP_URL/,
    );
  });
});
