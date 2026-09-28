/**
 * Booking statuses (docs/product/booking.md, ADR-0008). Payment statuses live in their own
 * machine (BR-41, CLAUDE.md rule 6) and ON_TRIP is computed, never stored (rule 8).
 */

export const BOOKING_STATUSES = [
  "REQUESTED",
  "ACCEPTED",
  "REFUSED",
  "CANCELLED",
  "CONFIRMED",
  "DRIVER_ASSIGNED",
  "IN_PROGRESS",
  "NO_SHOW",
  "COMPLETED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Status of a booking at creation (reserved to CUSTOMER, see transitions.ts). */
export const INITIAL_BOOKING_STATUS = "REQUESTED" satisfies BookingStatus;

/** No transition ever leaves these statuses. */
export const FINAL_BOOKING_STATUSES = [
  "REFUSED",
  "CANCELLED",
  "NO_SHOW",
  "COMPLETED",
] as const satisfies readonly BookingStatus[];

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (BOOKING_STATUSES as readonly string[]).includes(value);
}
