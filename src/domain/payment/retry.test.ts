import { describe, expect, it } from "vitest";

import { computeBaseFare } from "../pricing/base-fare";
import { PROVISIONAL_RULE, route } from "../pricing/fixtures";
import { buildPricingSnapshot } from "../pricing/snapshot";
import type { ChargeCandidate } from "./charge";
import {
  cancelIdempotencyKey,
  canRetryChargeAs,
  checkRetryable,
  planChargeRetry,
  retryRefusal,
  type RetryIntent,
} from "./retry";

const snapshot = buildPricingSnapshot({
  fare: computeBaseFare(PROVISIONAL_RULE, route()),
  inputs: {
    origin: { lat: 48.8443, lng: 2.3743 },
    destination: { lat: 49.0097, lng: 2.5479 },
    pickupLocalDateTime: "2026-11-02T10:00",
    timeZone: "Europe/Paris",
    pickupAt: "2026-11-02T09:00:00.000Z",
    passengers: 2,
    luggage: 1,
  },
  resolvedPoints: {
    origin: { lat: 48.8443, lng: 2.3743 },
    destination: { lat: 49.0097, lng: 2.5479 },
  },
  quotedAt: new Date("2026-09-30T08:00:00Z"),
});
const total = snapshot.totals.ttcCents;

function candidate(
  overrides: {
    booking?: Partial<ChargeCandidate["booking"]>;
    payment?: Partial<NonNullable<ChargeCandidate["payment"]>> | null;
  } = {},
): ChargeCandidate {
  return {
    booking: {
      id: "booking-1",
      status: "ACCEPTED",
      currentPaymentId: "payment-1",
      totalTtcCents: total,
      currency: "EUR",
      pricingSnapshot: snapshot,
      ...overrides.booking,
    },
    payment:
      overrides.payment === null
        ? null
        : {
            id: "payment-1",
            bookingId: "booking-1",
            status: "FAILED",
            attempt: 1,
            stripePaymentIntentId: "pi_Attempt1",
            amountCents: total,
            currency: "EUR",
            ...overrides.payment,
          },
  };
}

const intent = (status: string, attempt: number | null = 1, id = `pi_${status}`): RetryIntent => ({
  id,
  status,
  attempt,
});

describe("canRetryChargeAs", () => {
  it("allows ADMIN only (DEC-27)", () => {
    expect(canRetryChargeAs("ADMIN")).toBe(true);
    expect(canRetryChargeAs("DISPATCHER")).toBe(false);
    expect(canRetryChargeAs("DRIVER")).toBe(false);
    expect(canRetryChargeAs("CUSTOMER")).toBe(false);
  });
});

describe("retryRefusal", () => {
  it.each([
    ["ACCEPTED", "FAILED", 1],
    ["ACCEPTED", "FAILED", 7],
    ["ACCEPTED", "PENDING", 1],
    ["ACCEPTED", "PENDING", 3],
  ] as const)("allows %s booking with a %s payment at attempt %i", (booking, payment, attempt) => {
    expect(retryRefusal({ bookingStatus: booking, paymentStatus: payment, attempt })).toBeNull();
  });

  it.each([
    ["REQUESTED", "FAILED", 1, "booking_not_accepted"],
    ["CONFIRMED", "PAID", 1, "booking_not_accepted"],
    ["CANCELLED", "FAILED", 1, "booking_not_accepted"],
    ["ACCEPTED", "REQUIRES_ACTION", 1, "payment_requires_action"],
    ["ACCEPTED", "PENDING", 0, "no_attempt_yet"],
    ["ACCEPTED", "PAID", 1, "payment_not_retryable"],
    ["ACCEPTED", "CANCELED", 1, "payment_not_retryable"],
    ["ACCEPTED", "AUTHORIZED", 1, "payment_not_retryable"],
  ] as const)("refuses %s booking with a %s payment (attempt %i): %s", (b, p, attempt, reason) => {
    expect(retryRefusal({ bookingStatus: b, paymentStatus: p, attempt })).toBe(reason);
  });
});

describe("checkRetryable", () => {
  it("accepts a FAILED payment at the frozen amount", () => {
    expect(checkRetryable(candidate())).toEqual({ ok: true, amountCents: total, currency: "EUR" });
  });

  it("accepts a PENDING payment after an interrupted first attempt", () => {
    expect(
      checkRetryable(candidate({ payment: { status: "PENDING", stripePaymentIntentId: null } })),
    ).toMatchObject({ ok: true });
  });

  it("checks ownership before the statuses", () => {
    expect(
      checkRetryable(
        candidate({ booking: { status: "CONFIRMED" }, payment: { bookingId: "booking-2" } }),
      ),
    ).toEqual({
      ok: false,
      refusal: { code: "PAYMENT_STATE_INCONSISTENT", reason: "payment_of_other_booking" },
    });
    expect(checkRetryable(candidate({ booking: { currentPaymentId: "payment-2" } }))).toEqual({
      ok: false,
      refusal: { code: "PAYMENT_STATE_INCONSISTENT", reason: "payment_not_current" },
    });
  });

  it.each([
    ["no payment", { payment: null }, "no_payment"],
    ["REQUIRES_ACTION", { payment: { status: "REQUIRES_ACTION" as const } }, "payment_requires_action"],
    ["an untouched PENDING", { payment: { status: "PENDING" as const, attempt: 0 } }, "no_attempt_yet"],
    ["a CONFIRMED booking", { booking: { status: "CONFIRMED" as const } }, "booking_not_accepted"],
  ])("refuses %s with PAYMENT_NOT_RETRYABLE", (_label, overrides, reason) => {
    expect(checkRetryable(candidate(overrides))).toEqual({
      ok: false,
      refusal: { code: "PAYMENT_NOT_RETRYABLE", reason },
    });
  });

  it.each([
    ["payment vs booking", { payment: { amountCents: total + 1 } }, "payment_vs_booking"],
    ["an invalid snapshot", { booking: { pricingSnapshot: {} } }, "invalid_snapshot"],
  ])("never retries on an amount mismatch (%s)", (_label, overrides, reason) => {
    expect(checkRetryable(candidate(overrides))).toEqual({
      ok: false,
      refusal: { code: "PAYMENT_AMOUNT_MISMATCH", reason },
    });
  });
});

describe("planChargeRetry", () => {
  it("charges when Stripe knows no PaymentIntent", () => {
    expect(planChargeRetry([])).toEqual({ kind: "charge", toCancel: [] });
  });

  it("reconciles a succeeded PaymentIntent, whatever else exists", () => {
    const succeeded = intent("succeeded", 1);
    expect(planChargeRetry([intent("processing", 2), succeeded])).toEqual({
      kind: "reconcile",
      intent: succeeded,
    });
  });

  it.each(["processing", "requires_capture", "something_new"])(
    "blocks the retry on a %s PaymentIntent",
    (status) => {
      expect(planChargeRetry([intent("requires_payment_method", 1), intent(status, 2)])).toEqual({
        kind: "in_progress",
      });
    },
  );

  it("cancels every still-open PaymentIntent and ignores canceled ones", () => {
    const open = [
      intent("requires_payment_method", 3),
      intent("requires_action", 2),
      intent("requires_confirmation", null),
    ];
    expect(planChargeRetry([...open, intent("canceled", 1)])).toEqual({
      kind: "charge",
      toCancel: open,
    });
  });
});

describe("cancelIdempotencyKey", () => {
  it("is per booking and per attempt of the cancelled PaymentIntent", () => {
    expect(cancelIdempotencyKey("b1", intent("requires_payment_method", 2))).toBe(
      "booking:b1:cancel:2",
    );
  });

  it("falls back to the PaymentIntent id without attempt metadata", () => {
    expect(cancelIdempotencyKey("b1", intent("requires_action", null, "pi_Foreign1"))).toBe(
      "booking:b1:cancel:pi_Foreign1",
    );
  });

  it("refuses an empty booking id", () => {
    expect(() => cancelIdempotencyKey("", intent("requires_action"))).toThrow(RangeError);
  });
});
