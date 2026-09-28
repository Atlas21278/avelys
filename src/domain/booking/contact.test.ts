import { describe, expect, it } from "vitest";

import { resolveBookingContact } from "./contact";

const CUSTOMER = { name: "Profile Name", phone: "+33100000000", preferredLocale: "fr" } as const;

describe("resolveBookingContact", () => {
  it("uses the booking's own contact copy when present", () => {
    expect(
      resolveBookingContact(
        { contactName: "Trip Name", contactPhone: "+33199999999", contactLocale: "en" },
        CUSTOMER,
      ),
    ).toEqual({ name: "Trip Name", phone: "+33199999999", locale: "en", source: "booking" });
  });

  it("keeps a missing phone of the booking copy instead of the profile's (possibly stale) one", () => {
    expect(
      resolveBookingContact(
        { contactName: "Trip Name", contactPhone: null, contactLocale: "fr" },
        CUSTOMER,
      ),
    ).toEqual({ name: "Trip Name", phone: null, locale: "fr", source: "booking" });
  });

  it("falls back to the customer profile for a booking without a copy (legacy row)", () => {
    expect(
      resolveBookingContact(
        { contactName: null, contactPhone: null, contactLocale: null },
        CUSTOMER,
      ),
    ).toEqual({ name: "Profile Name", phone: "+33100000000", locale: "fr", source: "customer" });
  });

  it("falls back as a whole when the copy is incomplete, never mixing both sources", () => {
    expect(
      resolveBookingContact(
        { contactName: "Trip Name", contactPhone: "+33199999999", contactLocale: null },
        CUSTOMER,
      ),
    ).toEqual({ name: "Profile Name", phone: "+33100000000", locale: "fr", source: "customer" });
    expect(
      resolveBookingContact(
        { contactName: null, contactPhone: "+33199999999", contactLocale: "en" },
        { ...CUSTOMER, phone: null },
      ),
    ).toEqual({ name: "Profile Name", phone: null, locale: "fr", source: "customer" });
  });
});
