import "server-only";

import { stripePaymentIntents, stripePaymentSetup } from "@/integrations/stripe";

import { chargeBooking } from "./charge-booking";
import { createPaymentSetup, type PaymentSetup } from "./setup-intent";

export {
  PaymentSetupRequestError,
  type PaymentSetup,
  type PaymentSetupErrorCode,
} from "./setup-intent";

/** Payment method registration with the production Stripe gateway (test mode only). */
export function requestPaymentSetup(input: unknown): Promise<PaymentSetup> {
  return createPaymentSetup(input, { gateway: stripePaymentSetup });
}

/**
 * `onBookingAccepted` implementation (VTC-033): off-session charge of the accepted booking with
 * the production Stripe gateway (test mode only). Outcomes are logged by `chargeBooking`; an
 * unexpected error propagates to the decision service, which logs it and keeps the booking
 * `ACCEPTED`.
 */
export async function chargeAcceptedBooking(bookingId: string): Promise<void> {
  await chargeBooking(bookingId, { gateway: stripePaymentIntents });
}
