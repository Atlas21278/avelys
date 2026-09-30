import "server-only";

/**
 * Post-commit ports of the booking decision service (VTC-032). They run after the transaction
 * that moved the booking has committed: their failure is logged by the caller and never undoes
 * the decision (BR-50, docs/product/payments.md: the booking stays `ACCEPTED`). Implementations
 * must be idempotent, since a retry may call them again for the same booking.
 */

/**
 * Called once a booking is `ACCEPTED`. The back-office server action wires the off-session charge
 * here (`chargeAcceptedBooking`, VTC-033).
 */
export type OnBookingAccepted = (bookingId: string) => Promise<void>;

/** Default of the service (tests, callers without payment): accepting triggers nothing. */
export const onBookingAcceptedNoop: OnBookingAccepted = async () => {};
