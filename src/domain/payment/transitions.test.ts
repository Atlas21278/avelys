import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { INITIAL_PAYMENT_STATUS, isPaymentStatus, PAYMENT_STATUSES } from "./status";
import type { PaymentStatus } from "./status";
import {
  allowedPaymentTransitions,
  assertPaymentTransition,
  canTransitionPayment,
  InvalidPaymentTransitionError,
  PAYMENT_TRANSITIONS,
} from "./transitions";

/**
 * Expected table, written by hand from the VTC-031 ticket and the "Transitions Payment" table of
 * docs/product/payments.md — deliberately NOT derived from the code under test.
 */
const EXPECTED: ReadonlySet<string> = new Set([
  "PENDING>REQUIRES_ACTION",
  "PENDING>PAID",
  "PENDING>FAILED",
  "PENDING>CANCELED",
  "REQUIRES_ACTION>PAID",
  "REQUIRES_ACTION>FAILED",
  "REQUIRES_ACTION>CANCELED",
  "FAILED>REQUIRES_ACTION",
  "FAILED>PAID",
  "FAILED>CANCELED",
  "PAID>PARTIALLY_REFUNDED",
  "PAID>REFUNDED",
  "PARTIALLY_REFUNDED>PARTIALLY_REFUNDED",
  "PARTIALLY_REFUNDED>REFUNDED",
]);

const ALL_STATUSES = [
  "PENDING",
  "REQUIRES_ACTION",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const satisfies readonly PaymentStatus[];

const PAIRS = ALL_STATUSES.flatMap((from) => ALL_STATUSES.map((to) => [from, to] as const));

describe("payment statuses", () => {
  it("lists the eight statuses of payments.md, in order", () => {
    expect([...PAYMENT_STATUSES]).toEqual([...ALL_STATUSES]);
  });

  it("starts a Payment in PENDING (payment method saved, nothing charged)", () => {
    expect(INITIAL_PAYMENT_STATUS).toBe("PENDING");
  });

  it("recognises statuses only", () => {
    expect(isPaymentStatus("PAID")).toBe(true);
    expect(isPaymentStatus("paid")).toBe(false);
    expect(isPaymentStatus("REFUSED")).toBe(false);
    expect(isPaymentStatus(undefined)).toBe(false);
  });
});

describe("payment transition table", () => {
  it("contains exactly the expected rows, without duplicates", () => {
    const keys = PAYMENT_TRANSITIONS.map(({ from, to }) => `${from}>${to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(EXPECTED);
  });

  it.each(PAIRS)("%s -> %s follows the table", (from, to) => {
    const allowed = EXPECTED.has(`${from}>${to}`);
    expect(canTransitionPayment(from, to)).toBe(allowed);
    if (allowed) {
      expect(() => assertPaymentTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertPaymentTransition(from, to)).toThrow(InvalidPaymentTransitionError);
    }
  });

  it("gives AUTHORIZED no transition in or out (reserved, ADR-0006)", () => {
    expect(allowedPaymentTransitions("AUTHORIZED")).toEqual([]);
    expect(PAYMENT_TRANSITIONS.some(({ to }) => to === "AUTHORIZED")).toBe(false);
  });

  it("never leaves REFUNDED and never goes back to PENDING", () => {
    expect(allowedPaymentTransitions("REFUNDED")).toEqual([]);
    expect(PAYMENT_TRANSITIONS.some(({ to }) => to === "PENDING")).toBe(false);
  });

  it("lists the reachable statuses of a given status", () => {
    expect(allowedPaymentTransitions("PENDING")).toEqual([
      "REQUIRES_ACTION",
      "PAID",
      "FAILED",
      "CANCELED",
    ]);
  });

  it("raises a stable, data-free domain error", () => {
    const error: unknown = (() => {
      try {
        assertPaymentTransition("PAID", "FAILED");
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(InvalidPaymentTransitionError);
    const typed = error as InvalidPaymentTransitionError;
    expect(typed.code).toBe("INVALID_PAYMENT_TRANSITION");
    expect(typed.from).toBe("PAID");
    expect(typed.to).toBe("FAILED");
    expect(typed.message).toBe("Invalid payment transition: PAID -> FAILED");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(PAYMENT_TRANSITIONS)).toBe(true);
    expect(PAYMENT_TRANSITIONS.every((transition) => Object.isFrozen(transition))).toBe(true);
  });
});
