import "server-only";

import type { BookingStatus } from "@/domain/booking/status";
import type { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";

import {
  BookingCreationError,
  createBooking,
  parseBookingRequest,
  type CreateBookingDeps,
} from "./create-booking";

/**
 * Idempotent submission of a public booking request (VTC-045, docs/product/booking.md). The
 * natural idempotency key of a request is its `paymentSetupId`: one SetupIntent backs at most one
 * booking (unique `Payment.stripeSetupIntentId`). A second submission of the same form — a double
 * click, a retry after a lost response — gets the booking already created instead of an error:
 *
 * - before any quote, a SetupIntent already attached to a booking whose customer has the same
 *   normalised email is answered with that booking, without any write nor any Stripe or Maps
 *   call; another email is refused (`PAYMENT_METHOD_REQUIRED`);
 * - two concurrent submissions: the loser fails on the unique constraint (or on the guard's
 *   database check), reads the winner's booking back and answers the same.
 *
 * No migration: the key is the existing unique column.
 */

export type SubmittedBooking = Readonly<{
  reference: string;
  /** Current status of the booking (a replay answers with the status of the day). */
  status: BookingStatus;
  /** True when the booking already existed: nothing was written by this submission. */
  replayed: boolean;
}>;

/** Trim + lower case, as `ContactEmailSchema` stores the customer email. */
function normalisedEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The booking already backed by `paymentSetupId`, for the same email; null when the SetupIntent
 * backs no booking. Another email is a refusal: the SetupIntent is someone else's.
 */
async function priorSubmission(
  db: Pick<PrismaClient, "payment">,
  paymentSetupId: string,
  email: string,
): Promise<SubmittedBooking | null> {
  const payment = await db.payment.findUnique({
    where: { stripeSetupIntentId: paymentSetupId },
    select: {
      booking: { select: { reference: true, status: true, customer: { select: { email: true } } } },
    },
  });
  if (!payment) return null;

  const { booking } = payment;
  if (normalisedEmail(booking.customer.email) !== email) {
    logger().info({ reason: "payment_setup_already_used" }, "payment method refused");
    throw new BookingCreationError(
      "PAYMENT_METHOD_REQUIRED",
      "payment_setup_already_used",
      "This payment setup is already used by another booking",
    );
  }
  // The public reference only (BR-60).
  logger().info({ bookingRef: booking.reference }, "booking request replayed");
  return { reference: booking.reference, status: booking.status, replayed: true };
}

export async function submitBooking(
  input: unknown,
  deps: CreateBookingDeps,
): Promise<SubmittedBooking> {
  const request = parseBookingRequest(input);
  const { paymentSetupId } = request;
  const email = request.customer.email;

  if (paymentSetupId !== undefined) {
    const prior = await priorSubmission(deps.db, paymentSetupId, email);
    if (prior) return prior;
  }

  try {
    const created = await createBooking(input, deps);
    return { reference: created.reference, status: created.status, replayed: false };
  } catch (error) {
    // Lost a race with a concurrent submission of the same form: answer with its booking.
    if (
      paymentSetupId !== undefined &&
      error instanceof BookingCreationError &&
      error.code === "PAYMENT_METHOD_REQUIRED"
    ) {
      const prior = await priorSubmission(deps.db, paymentSetupId, email);
      if (prior) return prior;
    }
    throw error;
  }
}
