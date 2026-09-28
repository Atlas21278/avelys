import "server-only";

import { quote } from "@/server/quotes";
import { db } from "@/server/db";

import { createBooking, type CreateBookingDeps, type CreatedBooking } from "./create-booking";
import { paymentMethodGuardNotConfigured } from "./payment-method-guard";
import { generateReference } from "./reference";

/**
 * Production wiring of the booking creation service. The payment guard fails closed until
 * VTC-031 provides the Stripe implementation: no booking can be created before that.
 * No route calls this yet (the public form is a later ticket).
 */
export function createBookingDeps(): CreateBookingDeps {
  return {
    quote,
    paymentMethodGuard: paymentMethodGuardNotConfigured,
    generateReference,
    db: db(),
  };
}

/** Creates a `REQUESTED` booking with the production dependencies. */
export function requestBooking(input: unknown): Promise<CreatedBooking> {
  return createBooking(input, createBookingDeps());
}
