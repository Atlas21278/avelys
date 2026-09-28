import { describe, expect, it } from "vitest";

import { assertSeedAllowed, SeedNotAllowedError } from "./seed-guard";

describe("assertSeedAllowed", () => {
  it.each(["local", "ci"])("accepts APP_ENV=%s", (appEnv) => {
    expect(() => assertSeedAllowed(appEnv)).not.toThrow();
  });

  it.each(["staging", "production", "", "LOCAL", " local", "ci ", "test", "development"])(
    "refuses APP_ENV=%j",
    (appEnv) => {
      expect(() => assertSeedAllowed(appEnv)).toThrow(SeedNotAllowedError);
    },
  );

  it("refuses when APP_ENV is unset", () => {
    expect(() => assertSeedAllowed(undefined)).toThrow(/APP_ENV is unset/);
  });
});
