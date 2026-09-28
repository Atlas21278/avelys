/**
 * Minimum booking lead time (BR-31). The duration is a provisional, configurable value supplied
 * by the caller (`BOOKING_MIN_LEAD_TIME_MINUTES`); none is set here (BR-02). Pure: the caller
 * passes the current instant.
 */

const MS_PER_MINUTE = 60_000;

/** Earliest pickup instant that can still be booked online at `now`. */
export function earliestBookablePickup(now: Date, minLeadTimeMinutes: number): Date {
  if (!Number.isSafeInteger(minLeadTimeMinutes) || minLeadTimeMinutes < 0) {
    throw new RangeError("minLeadTimeMinutes must be a non-negative integer");
  }
  return new Date(now.getTime() + minLeadTimeMinutes * MS_PER_MINUTE);
}

/**
 * True when `pickupAt` is at least the lead time after `now`; a pickup exactly at the limit is
 * accepted. Below it, the customer is offered direct contact (DEC-20), not an online booking.
 */
export function meetsLeadTime(pickupAt: Date, now: Date, minLeadTimeMinutes: number): boolean {
  return pickupAt.getTime() >= earliestBookablePickup(now, minLeadTimeMinutes).getTime();
}
