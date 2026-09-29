import "server-only";

import type { BookingStatus } from "@/domain/booking/status";
import { assertTransition, type BookingActor } from "@/domain/booking/transitions";
import type { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { currentCorrelationId } from "@/lib/request-context";
import { writeAuditLog } from "@/server/audit/audit-log";
import { db } from "@/server/db";

import { onBookingAcceptedNoop, type OnBookingAccepted } from "./after-decision";

/**
 * Accept or refuse a `REQUESTED` booking (VTC-032, Master Spec §6.3, ADR-0008). One transaction
 * checks the transition with the domain table, applies it under an optimistic lock (`version`)
 * and writes the AuditLog row: either all three happen or nothing does. No charge here: a
 * refusal never touches the saved payment method, and the charge on acceptance (VTC-033) plugs
 * into the post-commit port `onBookingAccepted`. No email (EPIC-13), no refusal reason.
 *
 * Authorization of the request (session, role, 2FA) is the caller's job
 * (`runBookingDecision`); this service still refuses any actor the transition table does not
 * list, so a caller mistake cannot let a DRIVER or a CUSTOMER decide.
 */

export type BookingDecision = "ACCEPTED" | "REFUSED";

const AUDIT_ACTIONS = {
  ACCEPTED: "booking.accept",
  REFUSED: "booking.refuse",
} as const satisfies Record<BookingDecision, string>;

export interface DecisionActor {
  readonly role: BookingActor;
  /** Staff user id, recorded as the AuditLog actor. */
  readonly userId: string;
}

export interface DecideBookingDeps {
  readonly db?: PrismaClient;
  readonly onBookingAccepted?: OnBookingAccepted;
}

export type BookingDecisionErrorCode = "BOOKING_NOT_FOUND" | "BOOKING_CONCURRENT_UPDATE";

/** Nothing is written when this is raised. The message carries the reference at most. */
export class BookingDecisionError extends Error {
  override readonly name = "BookingDecisionError";

  constructor(
    readonly code: BookingDecisionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type DecidedBooking = Readonly<{
  bookingId: string;
  reference: string;
  status: BookingDecision;
  version: number;
}>;

/**
 * Applies `decision` to the booking `reference` (canonical form) if its version is still
 * `expectedVersion`. Errors: `InvalidBookingTransitionError` when the current status or the
 * actor does not allow it, `BookingDecisionError` for an unknown booking or a stale version.
 */
async function decideBooking(
  decision: BookingDecision,
  reference: string,
  expectedVersion: number,
  actor: DecisionActor,
  deps: DecideBookingDeps,
): Promise<DecidedBooking> {
  const client = deps.db ?? db();

  const decided = await client.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { reference },
      select: { id: true, reference: true, status: true, version: true },
    });
    if (!booking) throw new BookingDecisionError("BOOKING_NOT_FOUND", "Unknown booking");

    // Status first: a booking already decided by a colleague reports the real reason.
    assertTransition(booking.status, decision, actor.role);
    if (booking.version !== expectedVersion) {
      throw new BookingDecisionError(
        "BOOKING_CONCURRENT_UPDATE",
        `Booking ${booking.reference} changed since it was displayed`,
      );
    }

    // Optimistic lock: a concurrent decision that committed first has bumped the version, so
    // this update matches no row (PostgreSQL re-checks the WHERE clause after the row lock).
    const from: BookingStatus = booking.status;
    const updated = await tx.booking.updateMany({
      where: { id: booking.id, version: expectedVersion, status: from },
      data: { status: decision, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new BookingDecisionError(
        "BOOKING_CONCURRENT_UPDATE",
        `Booking ${booking.reference} was updated concurrently`,
      );
    }

    const version = expectedVersion + 1;
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS[decision],
      actorType: actor.role,
      actorId: actor.userId,
      entityId: booking.id,
      before: { bookingRef: booking.reference, status: from, version: expectedVersion },
      after: { bookingRef: booking.reference, status: decision, version },
      correlationId: currentCorrelationId() ?? null,
    });

    return { bookingId: booking.id, reference: booking.reference, status: decision, version };
  });

  // Public reference and statuses only (BR-60).
  logger().info(
    { bookingRef: decided.reference, from: "REQUESTED", to: decided.status, actor: actor.role },
    "booking decided",
  );
  return decided;
}

/** `REQUESTED → ACCEPTED`, then the post-commit port. The port never undoes the acceptance. */
export async function acceptBooking(
  reference: string,
  expectedVersion: number,
  actor: DecisionActor,
  deps: DecideBookingDeps = {},
): Promise<DecidedBooking> {
  const accepted = await decideBooking("ACCEPTED", reference, expectedVersion, actor, deps);

  const onAccepted = deps.onBookingAccepted ?? onBookingAcceptedNoop;
  try {
    await onAccepted(accepted.bookingId);
  } catch (error) {
    logger().error(
      {
        bookingRef: accepted.reference,
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "onBookingAccepted failed; the booking stays ACCEPTED",
    );
  }
  return accepted;
}

/** `REQUESTED → REFUSED`. Nothing is charged: the saved payment method is not used. */
export async function refuseBooking(
  reference: string,
  expectedVersion: number,
  actor: DecisionActor,
  deps: DecideBookingDeps = {},
): Promise<DecidedBooking> {
  return decideBooking("REFUSED", reference, expectedVersion, actor, deps);
}
