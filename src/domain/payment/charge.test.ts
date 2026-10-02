import { describe, expect, it } from "vitest";

import { computeBaseFare } from "../pricing/base-fare";
import { PROVISIONAL_RULE, route } from "../pricing/fixtures";
import { buildPricingSnapshot } from "../pricing/snapshot";
import {
  AUTHENTICATION_REQUIRED,
  chargeIdempotencyKey,
  checkChargeable,
  paymentStatusForIntent,
  type ChargeCandidate,
} from "./charge";

const fare = computeBaseFare(PROVISIONAL_RULE, route());
const snapshot = buildPricingSnapshot({
  fare,
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
            status: "PENDING",
            attempt: 0,
            stripePaymentIntentId: null,
            amountCents: total,
            currency: "EUR",
            ...overrides.payment,
          },
  };
}

describe("chargeIdempotencyKey", () => {
  it("derives the key from the booking id and the attempt number", () => {
    expect(chargeIdempotencyKey("booking-1", 1)).toBe("booking:booking-1:charge:1");
    expect(chargeIdempotencyKey("booking-1", 2)).toBe("booking:booking-1:charge:2");
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses attempt %s", (attempt) => {
    expect(() => chargeIdempotencyKey("booking-1", attempt)).toThrow(RangeError);
  });

  it("refuses an empty booking id", () => {
    expect(() => chargeIdempotencyKey("", 1)).toThrow(RangeError);
  });
});

describe("paymentStatusForIntent", () => {
  it.each([
    ["succeeded", null, "PAID"],
    ["requires_payment_method", AUTHENTICATION_REQUIRED, "REQUIRES_ACTION"],
    ["requires_action", null, "REQUIRES_ACTION"],
    ["requires_payment_method", "card_declined", "FAILED"],
    ["requires_payment_method", "expired_card", "FAILED"],
    ["requires_payment_method", null, null],
    ["processing", null, null],
    ["canceled", null, null],
    ["requires_confirmation", null, null],
    ["requires_capture", null, null],
    ["an_unknown_status", null, null],
  ] as const)("%s with error %s -> %s", (status, errorCode, expected) => {
    expect(paymentStatusForIntent({ status, errorCode, declineCode: null })).toBe(expected);
  });

  it("uses the error code, not the status alone, to tell authentication from refusal", () => {
    const status = "requires_payment_method";
    expect(
      paymentStatusForIntent({ status, errorCode: "authentication_required", declineCode: null }),
    ).toBe("REQUIRES_ACTION");
    expect(
      paymentStatusForIntent({ status, errorCode: "insufficient_funds", declineCode: null }),
    ).toBe("FAILED");
  });

  it.each([
    ["card_declined", "authentication_required", "REQUIRES_ACTION"],
    ["authentication_required", "authentication_required", "REQUIRES_ACTION"],
    ["card_declined", "authentication_not_handled", "FAILED"],
    ["card_declined", "insufficient_funds", "FAILED"],
    [null, "generic_decline", "FAILED"],
  ] as const)(
    "maps error %s with decline code %s (soft decline shape) to %s",
    (errorCode, declineCode, expected) => {
      expect(
        paymentStatusForIntent({ status: "requires_payment_method", errorCode, declineCode }),
      ).toBe(expected);
    },
  );
});

describe("checkChargeable", () => {
  it("accepts an ACCEPTED booking with its untouched PENDING payment, at the frozen amount", () => {
    expect(checkChargeable(candidate())).toEqual({ ok: true, amountCents: total, currency: "EUR" });
  });

  it.each([
    ["no payment", { payment: null }, "no_payment"],
    ["no current payment pointer", { booking: { currentPaymentId: null } }, "no_payment"],
    ["a REQUESTED booking", { booking: { status: "REQUESTED" as const } }, "booking_not_accepted"],
    ["a CONFIRMED booking", { booking: { status: "CONFIRMED" as const } }, "booking_not_accepted"],
    ["a PAID payment", { payment: { status: "PAID" as const } }, "payment_not_pending"],
    ["a FAILED payment", { payment: { status: "FAILED" as const } }, "payment_not_pending"],
    ["an attempt already made", { payment: { attempt: 1 } }, "attempt_already_made"],
    [
      "a PaymentIntent already recorded",
      { payment: { stripePaymentIntentId: "pi_Test1" } },
      "attempt_already_made",
    ],
  ])("is an idempotent no-op for %s", (_label, overrides, reason) => {
    expect(checkChargeable(candidate(overrides))).toEqual({
      ok: false,
      refusal: { code: "NOT_CHARGEABLE", reason },
    });
  });

  it.each([
    [
      "a pointer to another payment",
      { booking: { status: "REQUESTED" as const, currentPaymentId: "payment-2" } },
      "payment_not_current",
    ],
    [
      "a payment of another booking",
      { booking: { status: "REQUESTED" as const }, payment: { bookingId: "booking-2" } },
      "payment_of_other_booking",
    ],
  ])("refuses %s as inconsistent, before any status check", (_label, overrides, reason) => {
    const inconsistent = candidate(overrides);
    expect(checkChargeable(inconsistent)).toEqual({
      ok: false,
      refusal: { code: "PAYMENT_STATE_INCONSISTENT", reason },
    });
  });

  it.each([
    [
      "a payment amount off the booking",
      { payment: { amountCents: total + 1 } },
      "payment_vs_booking",
    ],
    ["a payment currency off the booking", { payment: { currency: "USD" } }, "payment_vs_booking"],
    [
      "a booking total off the snapshot",
      { booking: { totalTtcCents: total + 1 }, payment: { amountCents: total + 1 } },
      "snapshot_vs_booking",
    ],
    [
      "an invalid snapshot",
      { booking: { pricingSnapshot: { schemaVersion: 1 } } },
      "invalid_snapshot",
    ],
    [
      "a tampered snapshot total",
      {
        booking: {
          pricingSnapshot: { ...snapshot, totals: { ...snapshot.totals, ttcCents: total + 100 } },
        },
      },
      "invalid_snapshot",
    ],
  ])("refuses %s without charging", (_label, overrides, reason) => {
    expect(checkChargeable(candidate(overrides))).toEqual({
      ok: false,
      refusal: { code: "PAYMENT_AMOUNT_MISMATCH", reason },
    });
  });
});
