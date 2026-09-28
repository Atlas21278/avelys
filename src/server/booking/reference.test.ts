import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidReference } from "@/domain/booking/reference";

import { generateReference } from "./reference";

describe("generateReference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns canonical references", () => {
    for (let i = 0; i < 1000; i += 1) expect(isValidReference(generateReference())).toBe(true);
  });

  it("never calls Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used for booking references");
    });
    for (let i = 0; i < 100; i += 1) generateReference();
    expect(spy).not.toHaveBeenCalled();
  });
});
