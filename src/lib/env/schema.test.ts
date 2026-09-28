import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./schema";

const valid = {
  NODE_ENV: "development",
  APP_ENV: "local",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:5433/avelys",
};

describe("parseServerEnv", () => {
  it("returns typed values for a valid environment, with defaults", () => {
    expect(parseServerEnv(valid)).toEqual({ ...valid, LOG_LEVEL: "info" });
  });

  it("ignores unrelated variables", () => {
    expect(parseServerEnv({ ...valid, PATH: "/usr/bin" })).toEqual({ ...valid, LOG_LEVEL: "info" });
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

  it("rejects a non-http URL", () => {
    expect(() => parseServerEnv({ ...valid, APP_URL: "ftp://example.com" })).toThrowError(
      /APP_URL/,
    );
  });
});
