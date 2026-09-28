import { randomInt } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import {
  BOOKING_REFERENCE_ALPHABET,
  BOOKING_REFERENCE_LENGTH,
  BOOKING_REFERENCE_PREFIX,
  createReference,
  drawReferenceChars,
  formatReference,
  InvalidBookingReferenceError,
  isValidReference,
  normalizeReference,
} from "./reference";
import type { RandomIntSource } from "./reference";

/** Written by hand from ADR-0015, deliberately not derived from the code under test. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const P = BOOKING_REFERENCE_PREFIX;
/** The prefix as a human might type it: lowercase, without its dash. */
const P_TYPED = P.toLowerCase().replace(/-/g, "");

/** Deterministic source replaying `values` in order (each must be in range). */
function sequence(values: readonly number[]): RandomIntSource {
  let i = 0;
  return (maxExclusive) => {
    const value = values[i % values.length] ?? 0;
    i += 1;
    expect(maxExclusive).toBe(32);
    return value;
  };
}

function expectInvalid(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidBookingReferenceError);
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as InvalidBookingReferenceError).code).toBe("INVALID_BOOKING_REFERENCE");
}

describe("constants", () => {
  it("uses the Crockford base32 alphabet of ADR-0015 and 8 characters", () => {
    expect(BOOKING_REFERENCE_ALPHABET).toBe(CROCKFORD);
    expect(new Set(BOOKING_REFERENCE_ALPHABET).size).toBe(32);
    expect(BOOKING_REFERENCE_LENGTH).toBe(8);
    for (const excluded of ["I", "L", "O", "U"]) {
      expect(BOOKING_REFERENCE_ALPHABET).not.toContain(excluded);
    }
  });

  it("has a non-empty prefix ending with a dash", () => {
    expect(P).toMatch(/^[A-Z]+-$/);
  });
});

describe("generation with a real random source", () => {
  const DRAWS = 5000;
  const references = Array.from({ length: DRAWS }, () => createReference(randomInt));

  it("always yields the prefix plus exactly 8 alphabet characters", () => {
    for (const reference of references) {
      expect(reference.startsWith(P)).toBe(true);
      const body = reference.slice(P.length);
      expect(body).toHaveLength(8);
      for (const char of body) expect(CROCKFORD).toContain(char);
      expect(isValidReference(reference)).toBe(true);
      expect(normalizeReference(reference)).toBe(reference);
    }
  });

  it("covers all 32 symbols in every position", () => {
    for (let position = 0; position < BOOKING_REFERENCE_LENGTH; position += 1) {
      const seen = new Set(references.map((reference) => reference[P.length + position]));
      expect(seen.size).toBe(32);
    }
  });

  it("does not repeat references (not sequential, not guessable)", () => {
    expect(new Set(references).size).toBe(DRAWS);
  });
});

describe("generation with an injected source", () => {
  it("is deterministic and maps indices to the alphabet", () => {
    expect(createReference(sequence([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(`${P}01234567`);
    expect(createReference(sequence([31, 30, 29, 28, 27, 26, 25, 24]))).toBe(`${P}ZYXWVTSR`);
    expect(drawReferenceChars(sequence([10, 17, 18, 19, 20, 21, 26, 27]))).toBe("AHJKMNTV");
  });

  it("rejects an out-of-range or non-integer source value", () => {
    for (const bad of [-1, 32, 1.5, Number.NaN]) {
      expect(() => drawReferenceChars(() => bad)).toThrow(RangeError);
    }
  });
});

describe("formatReference", () => {
  it("prefixes 8 canonical characters", () => {
    expect(formatReference("8K2M4P7Q")).toBe(`${P}8K2M4P7Q`);
  });

  it("rejects anything but 8 canonical characters", () => {
    for (const bad of [
      "",
      "8K2M4P7",
      "8K2M4P7QR",
      "8k2m4p7q",
      "8K2M4P7U",
      "8K2M4P7O",
      "8K2M-P7Q",
    ]) {
      expectInvalid(() => formatReference(bad));
    }
  });
});

describe("normalizeReference", () => {
  it.each([
    ["canonical", `${P}8K2M4P7Q`],
    ["lowercase", `${P}8k2m4p7q`.toLowerCase()],
    ["prefix without dash", `${P_TYPED}8K2M4P7Q`],
    ["prefix absent", "8K2M4P7Q"],
    ["spaces", `  ${P} 8K2M 4P7Q `],
    ["tabs and extra dashes", `${P}-8K2M-\t4P7Q-`],
    ["dictated in groups", "8k-2m-4p-7q"],
    ["unicode dashes", "8K2M‐4P7Q"],
  ])("accepts %s", (_label, input) => {
    expect(normalizeReference(input)).toBe(`${P}8K2M4P7Q`);
  });

  it("reads O as 0, I and L as 1, in either case", () => {
    expect(normalizeReference("O0oI1iL1")).toBe(`${P}00011111`);
    expect(normalizeReference(`${P_TYPED}-looi-ilo0`)).toBe(`${P}10011100`);
  });

  it("keeps a bare 8-character body that starts with the prefix letters", () => {
    const body = `${P_TYPED.toUpperCase()}${"12345678"}`.slice(0, 8);
    expect(normalizeReference(body)).toBe(`${P}${body}`);
  });

  it.each([
    ["empty string", ""],
    ["only separators", " - - "],
    ["U", "8K2M4P7U"],
    ["lowercase u", "8k2m4p7u"],
    ["accented letter", "8K2M4P7É"],
    ["accented lowercase", "8k2m4p7é"],
    ["ß (uppercases to SS)", "8K2M4Pß"],
    ["dotless i (uppercases to I)", "8K2M4P7ı"],
    ["7 characters", "8K2M4P7"],
    ["9 characters", "8K2M4P7QR"],
    ["prefix with 7 characters", `${P}8K2M4P7`],
    ["prefix with 9 characters", `${P}8K2M4P7QR`],
    ["punctuation", "8K2M.4P7Q"],
    ["underscore", "8K2M_4P7Q"],
    ["another prefix", "XYZ-8K2M4P7Q"],
    ["very long input", `${" ".repeat(100)}8K2M4P7Q`],
  ])("rejects %s", (_label, input) => {
    expectInvalid(() => normalizeReference(input));
  });

  it("never echoes the input in the error message", () => {
    expectInvalid(() => normalizeReference("secret-UUUU"));
    expect(() => normalizeReference("secret-UUUU")).toThrow(/^Invalid booking reference$/);
  });
});

describe("isValidReference", () => {
  it("accepts only the canonical stored form", () => {
    expect(isValidReference(`${P}8K2M4P7Q`)).toBe(true);
    expect(isValidReference("8K2M4P7Q")).toBe(false);
    expect(isValidReference(`${P}8k2m4p7q`)).toBe(false);
    expect(isValidReference(`${P}8K2M4P7O`)).toBe(false);
    expect(isValidReference(`${P}8K2M4P7`)).toBe(false);
    expect(isValidReference(` ${P}8K2M4P7Q`)).toBe(false);
    expect(isValidReference("")).toBe(false);
  });
});
