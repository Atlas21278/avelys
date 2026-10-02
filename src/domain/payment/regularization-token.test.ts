import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  RegularizationKeyError,
  signRegularizationToken,
  verifyRegularizationToken,
} from "./regularization-token";

const { timingSafeEqualSpy } = vi.hoisted(() => ({ timingSafeEqualSpy: vi.fn() }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});

// Test-only keys, not secrets.
const KEY = "test-only-regularization-key-0123456789";
const OTHER_KEY = "another-test-only-regularization-key-9876";
const CLAIM = { paymentId: "c1x9k2m3n4p5q6r7s8t9u0v1", attempt: 2 };

function flip(token: string, index: number): string {
  const char = token[index];
  const replacement = char === "A" ? "B" : "A";
  return token.slice(0, index) + replacement + token.slice(index + 1);
}

describe("regularisation token", () => {
  it("round-trips a claim", () => {
    const token = signRegularizationToken(CLAIM, KEY);
    expect(verifyRegularizationToken(token, KEY)).toEqual(CLAIM);
  });

  it("is URL-safe without a dot or a separator to escape", () => {
    const token = signRegularizationToken(CLAIM, KEY);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("is deterministic for a claim and differs between attempts", () => {
    const first = signRegularizationToken(CLAIM, KEY);
    expect(signRegularizationToken(CLAIM, KEY)).toBe(first);
    const retry = signRegularizationToken({ ...CLAIM, attempt: 3 }, KEY);
    expect(retry).not.toBe(first);
    expect(verifyRegularizationToken(retry, KEY)).toEqual({ ...CLAIM, attempt: 3 });
  });

  it("refuses a token signed with another key", () => {
    const token = signRegularizationToken(CLAIM, OTHER_KEY);
    expect(verifyRegularizationToken(token, KEY)).toBeNull();
  });

  it("refuses any altered character", () => {
    const token = signRegularizationToken(CLAIM, KEY);
    for (const index of [0, 5, token.length - 44, token.length - 43, token.length - 1]) {
      expect(verifyRegularizationToken(flip(token, index), KEY), String(index)).toBeNull();
    }
  });

  it("refuses a payload re-signed for another attempt without the key", () => {
    const token = signRegularizationToken(CLAIM, KEY);
    const signaturePart = token.slice(-43);
    const forged =
      Buffer.from(`v1:${CLAIM.paymentId}:3`, "utf8").toString("base64url") + signaturePart;
    expect(verifyRegularizationToken(forged, KEY)).toBeNull();
  });

  it("refuses a non-canonical spelling of the same signature", () => {
    const token = signRegularizationToken(CLAIM, KEY);
    // The last character carries 4 unused bits: change them, keep the decoded bytes.
    const last = token.at(-1)!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const value = alphabet.indexOf(last);
    const variant = token.slice(0, -1) + alphabet[value ^ 1];
    expect(Buffer.from(variant.slice(-43), "base64url")).toEqual(
      Buffer.from(token.slice(-43), "base64url"),
    );
    expect(verifyRegularizationToken(variant, KEY)).toBeNull();
  });

  it.each([
    "",
    "abc",
    "x".repeat(43),
    "x".repeat(201),
    "has.a.dot.has.a.dot.has.a.dot.has.a.dot.has.a.dot.has.a.dot",
    "spaces are not allowed spaces are not allowed spaces are not",
  ])("refuses the malformed token %#", (token) => {
    expect(verifyRegularizationToken(token, KEY)).toBeNull();
  });

  it("refuses a correctly signed payload of an unknown shape", () => {
    const signed = (payload: string) =>
      Buffer.from(payload, "utf8").toString("base64url") +
      createHmac("sha256", KEY).update(payload, "utf8").digest("base64url");
    // Sanity check: the helper builds valid tokens.
    expect(verifyRegularizationToken(signed(`v1:${CLAIM.paymentId}:2`), KEY)).toEqual(CLAIM);
    for (const payload of [
      `v2:${CLAIM.paymentId}:2`,
      `v1:${CLAIM.paymentId}:0`,
      `v1:${CLAIM.paymentId}:02`,
      `v1:${CLAIM.paymentId}:2:x`,
      `v1:UPPER:2`,
      `v1::2`,
    ]) {
      expect(verifyRegularizationToken(signed(payload), KEY), payload).toBeNull();
    }
  });

  it("compares signatures in constant time", () => {
    const token = signRegularizationToken(CLAIM, KEY);
    timingSafeEqualSpy.mockClear();
    verifyRegularizationToken(flip(token, token.length - 2), KEY);
    expect(timingSafeEqualSpy).toHaveBeenCalledOnce();
  });

  it("refuses to sign an invalid claim", () => {
    expect(() => signRegularizationToken({ paymentId: "Bad:Id", attempt: 1 }, KEY)).toThrow(
      RangeError,
    );
    expect(() => signRegularizationToken({ ...CLAIM, attempt: 0 }, KEY)).toThrow(RangeError);
    expect(() => signRegularizationToken({ ...CLAIM, attempt: 1.5 }, KEY)).toThrow(RangeError);
  });

  it("requires a key of at least 32 characters, without echoing it", () => {
    const short = "short-test-key";
    expect(() => signRegularizationToken(CLAIM, short)).toThrow(RegularizationKeyError);
    expect(() => verifyRegularizationToken("anything", short)).toThrow(RegularizationKeyError);
    try {
      signRegularizationToken(CLAIM, short);
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });
});
