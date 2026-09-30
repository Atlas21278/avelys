import "server-only";

import { stripePaymentSetup } from "@/integrations/stripe";
import { quote } from "@/server/quotes";
import { db } from "@/server/db";

import { createBooking, type CreateBookingDeps, type CreatedBooking } from "./create-booking";
import { createStripePaymentMethodGuard } from "./payment-method-guard";
import { generateReference } from "./reference";
import { submitBooking, type SubmittedBooking } from "./submit-booking";

/**
 * Production wiring of the booking creation service. The payment guard reads the SetupIntent
 * back from Stripe (test mode only, VTC-031); without a usable Stripe test key it fails with a
 * `PAYMENT_UNAVAILABLE` and no booking is created. `POST /api/v1/bookings` (VTC-045) calls
 * `submitBookingRequest`.
 */
export function createBookingDeps(): CreateBookingDeps {
  const client = db();
  return {
    quote,
    paymentMethodGuard: createStripePaymentMethodGuard({ gateway: stripePaymentSetup, db: client }),
    generateReference,
    db: client,
  };
}

/** Creates a `REQUESTED` booking with the production dependencies. */
export function requestBooking(input: unknown): Promise<CreatedBooking> {
  return createBooking(input, createBookingDeps());
}

/**
 * Idempotent submission of a public booking request (VTC-045): creates a `REQUESTED` booking, or
 * answers with the booking the same SetupIntent and email already created.
 */
export function submitBookingRequest(input: unknown): Promise<SubmittedBooking> {
  return submitBooking(input, createBookingDeps());
}
