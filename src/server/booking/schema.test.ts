import { describe, expect, it } from "vitest";

import { BOOKING_STATUSES } from "@/domain/booking/status";
import { BOOKING_ACTORS } from "@/domain/booking/transitions";
import { ActorType, BookingStatus, Locale, Prisma } from "@/generated/prisma/browser";
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
    const columns = Object.values(Prisma.BookingScalarFieldEnum).map((name) => name.toLowerCase());
    expect(columns.filter((name) => /payment|stripe|paid/.test(name))).toEqual([]);
  });

  it("keeps money in integer cents with separate HT, VAT and TTC (BR-10, BR-11)", () => {
    const columns = Object.values(Prisma.BookingScalarFieldEnum);
    expect(columns).toEqual(
      expect.arrayContaining(["totalTtcCents", "totalHtCents", "vatCents", "currency"]),
    );
  });
});
