import "server-only";

import { stripePaymentSetup } from "@/integrations/stripe";

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
