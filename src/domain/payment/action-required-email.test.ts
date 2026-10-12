import { describe, expect, it } from "vitest";

import {
  attemptOfPaymentActionRequiredKey,
  InvalidPaymentActionKeyError,
  paymentActionRequiredDedupeKey,
  paymentActionRequiredKeyPrefix,
} from "./action-required-email";

const PAYMENT_ID = "c1x9k2m3n4p5q6r7s8t9u0v1";

describe("paymentActionRequiredDedupeKey", () => {
  it("builds one key per Payment and attempt", () => {
    expect(paymentActionRequiredDedupeKey(PAYMENT_ID, 1)).toBe(
      `payment-action-required:${PAYMENT_ID}:1`,
    );
    expect(paymentActionRequiredDedupeKey(PAYMENT_ID, 2)).not.toBe(
      paymentActionRequiredDedupeKey(PAYMENT_ID, 1),
    );
  });

  it("is stable for the same attempt (replayed webhook, FAILED → REQUIRES_ACTION again)", () => {
    expect(paymentActionRequiredDedupeKey(PAYMENT_ID, 3)).toBe(
      paymentActionRequiredDedupeKey(PAYMENT_ID, 3),
    );
  });

  it("starts with the prefix of its Payment", () => {
    expect(
      paymentActionRequiredDedupeKey(PAYMENT_ID, 7).startsWith(
        paymentActionRequiredKeyPrefix(PAYMENT_ID),
      ),
    ).toBe(true);
    expect(paymentActionRequiredKeyPrefix(PAYMENT_ID)).toBe(
      `payment-action-required:${PAYMENT_ID}:`,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "refuses attempt %s",
    (attempt) => {
      expect(() => paymentActionRequiredDedupeKey(PAYMENT_ID, attempt)).toThrow(
        InvalidPaymentActionKeyError,
      );
    },
  );

  it.each(["", "a:b"])("refuses payment id %j", (paymentId) => {
    expect(() => paymentActionRequiredDedupeKey(paymentId, 1)).toThrow(
      InvalidPaymentActionKeyError,
    );
    expect(() => paymentActionRequiredKeyPrefix(paymentId)).toThrow(InvalidPaymentActionKeyError);
  });
});

describe("attemptOfPaymentActionRequiredKey", () => {
  it("reads the attempt back", () => {
    expect(attemptOfPaymentActionRequiredKey(paymentActionRequiredDedupeKey(PAYMENT_ID, 12))).toBe(
      12,
    );
  });

  it.each([
    "booking:x:payment-action-required:y",
    `payment-action-required:${PAYMENT_ID}:0`,
    `payment-action-required:${PAYMENT_ID}:`,
    `payment-action-required::1`,
    `payment-action-required:${PAYMENT_ID}:1:extra`,
  ])("returns null for %j", (key) => {
    expect(attemptOfPaymentActionRequiredKey(key)).toBeNull();
  });
});
