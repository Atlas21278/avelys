/**
 * Contact of a booking (VTC-037, DEC-25). Each booking keeps its own copy of the name, phone and
 * language submitted with it; a guest booking never rewrites the `Customer` profile. Bookings
 * created before the copy existed carry no contact columns and fall back to their customer.
 */

export type ContactLocale = "fr" | "en";

/** Contact columns of a booking; all null on bookings created before VTC-037. */
export interface BookingContactColumns {
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly contactLocale: ContactLocale | null;
}

export interface CustomerContactFields {
  readonly name: string;
  readonly phone: string | null;
  readonly preferredLocale: ContactLocale;
}

export interface BookingContact {
  readonly name: string;
  readonly phone: string | null;
  readonly locale: ContactLocale;
  /** Where the contact comes from: the booking's own copy, or the customer profile (fallback). */
  readonly source: "booking" | "customer";
}

/**
 * The contact to use for a booking. The booking copy wins as a whole when present (name and
 * language are always written together at creation); its null phone then means "no phone given
 * for this trip" and is never filled from the profile, which may hold a stale number. Without a
 * copy (legacy row), the whole contact comes from the customer profile.
 */
export function resolveBookingContact(
  booking: BookingContactColumns,
  customer: CustomerContactFields,
): BookingContact {
  if (booking.contactName !== null && booking.contactLocale !== null) {
    return {
      name: booking.contactName,
      phone: booking.contactPhone,
      locale: booking.contactLocale,
      source: "booking",
    };
  }
  return {
    name: customer.name,
    phone: customer.phone,
    locale: customer.preferredLocale,
    source: "customer",
  };
}
