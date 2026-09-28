/**
 * Booking state machine (ADR-0008): a single data table plus pure guards. It only decides;
 * the calling service checks time and payment preconditions (DEC-06, DEC-13, Payment PAID),
 * applies the change and writes the AuditLog in one transaction.
 */

import type { Role } from "../auth/access";
import { DomainError } from "../errors";
import { FINAL_BOOKING_STATUSES, INITIAL_BOOKING_STATUS } from "./status";
import type { BookingStatus } from "./status";

/** Who triggers a transition: an RBAC role (ADR-0005) or the platform itself. */
export const BOOKING_ACTORS = [
  "CUSTOMER",
  "ADMIN",
  "DISPATCHER",
  "DRIVER",
  "SYSTEM",
] as const satisfies readonly (Role | "SYSTEM")[];
export type BookingActor = (typeof BOOKING_ACTORS)[number];

export interface BookingTransition {
  readonly from: BookingStatus;
  readonly to: BookingStatus;
  readonly actors: readonly BookingActor[];
}

function row(from: BookingStatus, to: BookingStatus, actors: BookingActor[]): BookingTransition {
  return Object.freeze({ from, to, actors: Object.freeze(actors) });
}

/**
 * Literal transcription of the "Transitions autorisées" table of docs/product/booking.md.
 * Any change of rights goes through that document first, validated by the owner.
 */
export const BOOKING_TRANSITIONS: readonly BookingTransition[] = Object.freeze([
  row("REQUESTED", "ACCEPTED", ["ADMIN", "DISPATCHER"]),
  row("REQUESTED", "REFUSED", ["ADMIN", "DISPATCHER"]),
  row("REQUESTED", "CANCELLED", ["CUSTOMER"]),
  row("ACCEPTED", "CONFIRMED", ["SYSTEM"]),
  row("ACCEPTED", "CANCELLED", ["SYSTEM", "CUSTOMER", "ADMIN"]),
  row("CONFIRMED", "DRIVER_ASSIGNED", ["ADMIN", "DISPATCHER"]),
  row("CONFIRMED", "CANCELLED", ["CUSTOMER", "ADMIN"]),
  row("DRIVER_ASSIGNED", "CANCELLED", ["CUSTOMER", "ADMIN"]),
  row("DRIVER_ASSIGNED", "CONFIRMED", ["ADMIN", "DISPATCHER"]),
  row("DRIVER_ASSIGNED", "IN_PROGRESS", ["DRIVER"]),
  row("DRIVER_ASSIGNED", "NO_SHOW", ["DRIVER", "ADMIN"]),
  row("IN_PROGRESS", "COMPLETED", ["DRIVER"]),
]);

/** Actors allowed to create a booking (`- -> REQUESTED`). */
export const BOOKING_CREATION_ACTORS = Object.freeze([
  "CUSTOMER",
] as const satisfies readonly BookingActor[]);

/**
 * Raised for any transition, creation or actor not in the table. Carries statuses and actor
 * only (no personal data); `from` is null for a refused creation.
 */
export class InvalidBookingTransitionError extends DomainError {
  override readonly name = "InvalidBookingTransitionError";
  readonly code = "INVALID_BOOKING_TRANSITION";

  constructor(
    readonly from: BookingStatus | null,
    readonly to: BookingStatus,
    readonly actor: BookingActor,
  ) {
    super(`Invalid booking transition: ${from ?? "(none)"} -> ${to} by ${actor}`);
  }
}

export function isFinal(status: BookingStatus): boolean {
  return (FINAL_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
  actor: BookingActor,
): boolean {
  return BOOKING_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.actors.includes(actor),
  );
}

/** Throws InvalidBookingTransitionError unless `actor` may move a booking from `from` to `to`. */
export function assertTransition(
  from: BookingStatus,
  to: BookingStatus,
  actor: BookingActor,
): void {
  if (!canTransition(from, to, actor)) throw new InvalidBookingTransitionError(from, to, actor);
}

/** Statuses `actor` may move a booking to from `from` (empty for a final status). */
export function allowedTransitions(
  from: BookingStatus,
  actor: BookingActor,
): readonly BookingStatus[] {
  return BOOKING_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.actors.includes(actor),
  ).map((transition) => transition.to);
}

export function canCreateBooking(actor: BookingActor): boolean {
  return (BOOKING_CREATION_ACTORS as readonly BookingActor[]).includes(actor);
}

/** Throws InvalidBookingTransitionError (from = null) unless `actor` may create a booking. */
export function assertCanCreateBooking(actor: BookingActor): void {
  if (!canCreateBooking(actor)) {
    throw new InvalidBookingTransitionError(null, INITIAL_BOOKING_STATUS, actor);
  }
}
