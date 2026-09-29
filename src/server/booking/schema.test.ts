import { describe, expect, it } from "vitest";

import { BOOKING_STATUSES } from "@/domain/booking/status";
import { BOOKING_ACTORS } from "@/domain/booking/transitions";
import { PAYMENT_STATUSES } from "@/domain/payment/status";
import {
  ActorType,
  BookingStatus,
  Locale,
  PaymentStatus,
  Prisma,
} from "@/generated/prisma/browser";
import { routing } from "@/i18n/routing";

// Parity between the Prisma schema (VTC-026) and the pure domain: no database needed.
describe("booking schema parity", () => {
  it("BookingStatus enum matches the domain statuses, in order", () => {
    expect(Object.values(BookingStatus)).toEqual([...BOOKING_STATUSES]);
  });

  it("ActorType enum matches the booking actors, in order", () => {
    expect(Object.values(ActorType)).toEqual([...BOOKING_ACTORS]);
  });

  it("Locale enum matches the routed locales", () => {
    expect(Object.values(Locale)).toEqual([...routing.locales]);
  });

  it("stores neither ON_TRIP nor any payment status on Booking (BR-22, BR-41)", () => {
    expect(Object.values(BookingStatus)).not.toContain("ON_TRIP");
    const columns = Object.values(Prisma.BookingScalarFieldEnum);
    // The only payment column is the reference to the current Payment (VTC-031, §20.1): its
    // status is read from Payment, and no Stripe id lives on Booking.
    expect(columns.filter((name) => /payment|stripe|paid/i.test(name))).toEqual([
      "currentPaymentId",
    ]);
  });

  it("PaymentStatus enum matches the domain payment statuses, in order", () => {
    expect(Object.values(PaymentStatus)).toEqual([...PAYMENT_STATUSES]);
  });

  it("keeps payment money in integer cents and no card detail on Payment (BR-10, BR-40)", () => {
    const columns = Object.values(Prisma.PaymentScalarFieldEnum);
    expect(columns).toEqual(expect.arrayContaining(["amountCents", "currency"]));
    expect(columns.filter((name) => /card|pan|cvc|cvv|last4|expir|brand/i.test(name))).toEqual([]);
  });

  it("keeps money in integer cents with separate HT, VAT and TTC (BR-10, BR-11)", () => {
    const columns = Object.values(Prisma.BookingScalarFieldEnum);
    expect(columns).toEqual(
      expect.arrayContaining(["totalTtcCents", "totalHtCents", "vatCents", "currency"]),
    );
  });
});
