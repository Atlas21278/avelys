import "server-only";

import { stripePaymentSetup } from "@/integrations/stripe";
import { quote } from "@/server/quotes";
import { db } from "@/server/db";

import { createBooking, type CreateBookingDeps, type CreatedBooking } from "./create-booking";
import { createStripePaymentMethodGuard } from "./payment-method-guard";
import { generateReference } from "./reference";

/**
 * Production wiring of the booking creation service. The payment guard reads the SetupIntent
 * back from Stripe (test mode only, VTC-031); without a usable Stripe test key it fails with a
 * `StripeConfigError` and no booking is created. No route calls this yet (the public form is a
 * later ticket).
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
