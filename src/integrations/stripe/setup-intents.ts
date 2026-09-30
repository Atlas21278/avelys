import Stripe from "stripe";

import { StripeConfigError } from "./client";

/**
 * SetupIntent adapter (VTC-031, docs/product/payments.md step 1): saves a payment method for a
 * later off-session charge, never charges. The application sees plain summaries, never a Stripe
 * object, a card detail (BR-40) or a client secret outside the creation result.
 */

/** Marker set on the objects this flow creates, checked before a SetupIntent is trusted. */
export const BOOKING_REQUEST_FLOW = "booking_request";

/** Stripe object id shapes (`seti_…`, `cus_…`, `pm_…`). */
export const SETUP_INTENT_ID = /^seti_[A-Za-z0-9]+$/;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;
const PAYMENT_METHOD_ID = /^pm_[A-Za-z0-9]+$/;

export type CreatedSetupIntent = Readonly<{
  setupIntentId: string;
  /** Handed to Stripe.js only (Payment Element); never logged, never stored. */
  clientSecret: string;
}>;

/** What the application needs to know about a SetupIntent read back from Stripe. */
export type SetupIntentSummary = Readonly<{
  id: string;
  status: string;
  usage: string;
  livemode: boolean;
  /** Set only when the SetupIntent carries the marker of the booking request flow. */
  fromBookingRequestFlow: boolean;
  customerId: string | null;
  /**
   * Email held by the SetupIntent's Customer, read back from Stripe (VTC-045): the guard compares
   * it with the booking request. Null when Stripe returns no Customer object or no email. Never
   * logged.
   */
  customerEmail: string | null;
  paymentMethodId: string | null;
}>;

export interface PaymentSetupGateway {
  /**
   * Creates a Stripe Customer for this booking request and an off-session SetupIntent attached
   * to it. `journeyId` derives the idempotency keys, so a retried call never creates a second
   * Customer or SetupIntent: a server UUID, or the browser's `submissionId` (VTC-045). The same
   * `journeyId` with another email is refused by Stripe (`StripeIdempotencyError`).
   */
  createSetupIntent(input: { journeyId: string; email: string }): Promise<CreatedSetupIntent>;
  /** Reads a SetupIntent back from Stripe; null when Stripe does not know the id. */
  retrieveSetupIntent(setupIntentId: string): Promise<SetupIntentSummary | null>;
}

/** Stripe returned something the flow cannot use. Carries a reason, never an id or a secret. */
export class PaymentSetupError extends Error {
  override readonly name = "PaymentSetupError";

  constructor(readonly reason: "missing_client_secret") {
    super(`Unusable SetupIntent: ${reason}`);
  }
}

function objectId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

/** Email of an expanded Customer; null for an id, a deleted Customer or a Customer without one. */
function customerEmail(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (value === null || typeof value === "string" || value.deleted) return null;
  return value.email ?? null;
}

function matchOrNull(value: string | null, shape: RegExp): string | null {
  return value !== null && shape.test(value) ? value : null;
}

/** The subset of the Stripe client this adapter uses (a fake in unit tests). */
export type SetupIntentStripeClient = {
  customers: Pick<Stripe["customers"], "create">;
  setupIntents: Pick<Stripe["setupIntents"], "create" | "retrieve">;
};

export function createStripePaymentSetupGateway(
  stripe: SetupIntentStripeClient,
): PaymentSetupGateway {
  return {
    async createSetupIntent({ journeyId, email }) {
      const metadata = { flow: BOOKING_REQUEST_FLOW };
      // Created for this request only: a Customer is never looked up by email, so a card is
      // never attached to someone else's Customer on the strength of a typed address.
      const customer = await stripe.customers.create(
        { email, metadata },
        { idempotencyKey: `payment-setup:${journeyId}:customer` },
      );
      const setupIntent = await stripe.setupIntents.create(
        {
          customer: customer.id,
          usage: "off_session",
          payment_method_types: ["card"],
          metadata,
        },
        { idempotencyKey: `payment-setup:${journeyId}:setup-intent` },
      );
      if (!setupIntent.client_secret) throw new PaymentSetupError("missing_client_secret");
      return { setupIntentId: setupIntent.id, clientSecret: setupIntent.client_secret };
    },

    async retrieveSetupIntent(setupIntentId) {
      let setupIntent: Stripe.SetupIntent;
      try {
        // The Customer is expanded to read its email (VTC-045): one call, no extra permission.
        setupIntent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["customer"] });
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === "resource_missing"
        ) {
          return null;
        }
        throw error;
      }
      return {
        id: setupIntent.id,
        status: setupIntent.status,
        usage: setupIntent.usage,
        livemode: setupIntent.livemode,
        fromBookingRequestFlow: setupIntent.metadata?.flow === BOOKING_REQUEST_FLOW,
        customerId: matchOrNull(objectId(setupIntent.customer), CUSTOMER_ID),
        customerEmail: customerEmail(setupIntent.customer),
        paymentMethodId: matchOrNull(objectId(setupIntent.payment_method), PAYMENT_METHOD_ID),
      };
    },
  };
}

/**
 * Why Stripe cannot be used for a payment setup, as a short tag for logs (VTC-031, VTC-045): a
 * missing or non-test key, an unusable Stripe answer, or any Stripe API or network failure. Null
 * for any other error, which callers keep treating as a bug. The Stripe message is never used:
 * it may quote the request.
 */
export function stripeUnavailableReason(error: unknown): string | null {
  if (error instanceof StripeConfigError) return `stripe_${error.reason}`;
  if (error instanceof PaymentSetupError) return error.reason;
  if (error instanceof Stripe.errors.StripeError) return "stripe_error";
  return null;
}
