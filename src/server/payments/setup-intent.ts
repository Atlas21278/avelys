import "server-only";

import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { z } from "zod";

import { ContactEmailSchema } from "@/domain/booking/contact";
import {
  PaymentSetupError,
  StripeConfigError,
  type PaymentSetupGateway,
} from "@/integrations/stripe";

/**
 * Payment method registration, step 1 of docs/product/payments.md (VTC-031): a Stripe Customer
 * created for this booking request and an off-session SetupIntent, confirmed in the browser by
 * Stripe.js (SCA when the bank asks). No amount, no charge, no card data on the server (BR-40).
 * Only the client secret leaves this service.
 */

/** Strict: the email Stripe keeps on the Customer, nothing else (no amount, no Customer id). */
export const PaymentSetupRequestSchema = z.strictObject({ email: ContactEmailSchema });

export type PaymentSetupErrorCode = "INVALID_INPUT" | "PAYMENT_UNAVAILABLE";

/** Refusal of a payment setup. Message and reason carry no personal data and no secret. */
export class PaymentSetupRequestError extends Error {
  override readonly name = "PaymentSetupRequestError";

  constructor(
    readonly code: PaymentSetupErrorCode,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Payment setup refused: ${reason}`, options);
  }
}

export interface PaymentSetupDeps {
  /** Resolved on use: a missing or live key surfaces as `PAYMENT_UNAVAILABLE`. */
  readonly gateway: () => PaymentSetupGateway;
  /** Server-generated identifier of this registration; derives the Stripe idempotency keys. */
  readonly newJourneyId?: () => string;
}

export type PaymentSetup = Readonly<{ clientSecret: string }>;

function unavailableReason(error: unknown): string | null {
  if (error instanceof StripeConfigError) return `stripe_${error.reason}`;
  if (error instanceof PaymentSetupError) return error.reason;
  if (error instanceof Stripe.errors.StripeError) return "stripe_error";
  return null;
}

export async function createPaymentSetup(
  input: unknown,
  deps: PaymentSetupDeps,
): Promise<PaymentSetup> {
  const parsed = PaymentSetupRequestSchema.safeParse(input);
  if (!parsed.success) throw new PaymentSetupRequestError("INVALID_INPUT", "invalid_request");

  const journeyId = (deps.newJourneyId ?? randomUUID)();
  try {
    const created = await deps.gateway().createSetupIntent({ journeyId, email: parsed.data.email });
    return { clientSecret: created.clientSecret };
  } catch (error) {
    const reason = unavailableReason(error);
    if (reason === null) throw error;
    // The Stripe error is not attached: its message or raw payload may quote the request.
    throw new PaymentSetupRequestError("PAYMENT_UNAVAILABLE", reason);
  }
}
