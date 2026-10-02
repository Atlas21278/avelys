import Stripe from "stripe";

/**
 * PaymentIntent adapter (VTC-033, docs/product/payments.md step 2): the off-session charge of
 * the payment method saved at the request, and the reads the charge and the webhooks rely on.
 * The application sees plain summaries, never a Stripe object or a card detail (BR-40).
 */

/** Stripe PaymentIntent id shape (`pi_…`). */
export const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;

/** At most this many PaymentIntents are read per Customer; a Customer is dedicated to a booking. */
export const PAYMENT_INTENT_LIST_LIMIT = 100;

/** What the application needs to know about a PaymentIntent. */
export type PaymentIntentSummary = Readonly<{
  id: string;
  /** Stripe status (`succeeded`, `processing`, `requires_payment_method`…). */
  status: string;
  amountCents: number;
  /** ISO 4217, upper case. */
  currency: string;
  livemode: boolean;
  customerId: string | null;
  /** `metadata.bookingRef`, set by this adapter on creation. */
  bookingRef: string | null;
  /** `metadata.attempt` as an integer, null when absent or not a positive integer. */
  attempt: number | null;
  /** `last_payment_error.code` (e.g. `authentication_required`, `card_declined`). */
  lastPaymentErrorCode: string | null;
  /** `last_payment_error.decline_code` (e.g. `authentication_required` on a soft decline). */
  lastPaymentErrorDeclineCode: string | null;
}>;

export type OffSessionChargeInput = Readonly<{
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  /** ISO 4217 (upper or lower case). */
  currency: string;
  bookingRef: string;
  attempt: number;
  idempotencyKey: string;
}>;

/**
 * Outcome of the charge request. A card error carrying a PaymentIntent (declined, authentication
 * required) is a result, not an exception: `errorCode` holds the Stripe error code.
 */
export type OffSessionChargeResult = Readonly<{
  intent: PaymentIntentSummary;
  errorCode: string | null;
  /** Issuer `decline_code` of the card error, null without one. */
  declineCode: string | null;
}>;

export interface PaymentIntentGateway {
  /**
   * Creates and confirms an off-session PaymentIntent with automatic capture. Throws on a
   * technical failure (network, Stripe 5xx, configuration) and on a refusal without PaymentIntent.
   */
  createOffSessionCharge(input: OffSessionChargeInput): Promise<OffSessionChargeResult>;
  /**
   * PaymentIntents of a Customer, newest first (strongly consistent, unlike the Search API).
   * Throws when the Customer has more than `PAYMENT_INTENT_LIST_LIMIT` of them.
   */
  listCustomerPaymentIntents(customerId: string): Promise<readonly PaymentIntentSummary[]>;
  /** Reads a PaymentIntent back; null when Stripe does not know the id. */
  retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntentSummary | null>;
}

/** Stripe answered something the charge cannot rely on. Carries a reason, never an id. */
export class PaymentIntentError extends Error {
  override readonly name = "PaymentIntentError";

  constructor(readonly reason: "too_many_payment_intents" | "invalid_payment_intent_id") {
    super(`Unusable PaymentIntent answer: ${reason}`);
  }
}

function objectId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9][0-9]{0,8}$/.test(value)) return null;
  return Number(value);
}

export function summarizePaymentIntent(intent: Stripe.PaymentIntent): PaymentIntentSummary {
  const customerId = objectId(intent.customer);
  const metadata: Record<string, string> = intent.metadata ?? {};
  return {
    id: intent.id,
    status: intent.status,
    amountCents: intent.amount,
    currency: intent.currency.toUpperCase(),
    livemode: intent.livemode,
    customerId: customerId !== null && CUSTOMER_ID.test(customerId) ? customerId : null,
    bookingRef: metadata.bookingRef ?? null,
    attempt: positiveInt(metadata.attempt),
    lastPaymentErrorCode: intent.last_payment_error?.code ?? null,
    lastPaymentErrorDeclineCode: intent.last_payment_error?.decline_code ?? null,
  };
}

/** The subset of the Stripe client this adapter uses (a fake in unit tests). */
export type PaymentIntentStripeClient = {
  paymentIntents: Pick<Stripe["paymentIntents"], "create" | "list" | "retrieve">;
};

export function createStripePaymentIntentGateway(
  stripe: PaymentIntentStripeClient,
): PaymentIntentGateway {
  return {
    async createOffSessionCharge(input) {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: input.amountCents,
            currency: input.currency.toLowerCase(),
            customer: input.customerId,
            payment_method: input.paymentMethodId,
            // Card only, like the SetupIntent: no redirect-based method, hence no return_url.
            payment_method_types: ["card"],
            off_session: true,
            confirm: true,
            capture_method: "automatic",
            // Booking reference and attempt only: no description, no personal data (BR-60).
            metadata: { bookingRef: input.bookingRef, attempt: String(input.attempt) },
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return { intent: summarizePaymentIntent(intent), errorCode: null, declineCode: null };
      } catch (error) {
        // Off-session, a refused confirmation raises a card error that carries the PaymentIntent
        // (`authentication_required`, or `card_declined` with a decline code…): the outcome.
        if (error instanceof Stripe.errors.StripeCardError && error.payment_intent) {
          const lastError = error.payment_intent.last_payment_error;
          return {
            intent: summarizePaymentIntent(error.payment_intent),
            errorCode: error.code ?? lastError?.code ?? null,
            declineCode: error.decline_code ?? lastError?.decline_code ?? null,
          };
        }
        throw error;
      }
    },

    async listCustomerPaymentIntents(customerId) {
      const page = await stripe.paymentIntents.list({
        customer: customerId,
        limit: PAYMENT_INTENT_LIST_LIMIT,
      });
      if (page.has_more) throw new PaymentIntentError("too_many_payment_intents");
      return page.data.map(summarizePaymentIntent);
    },

    async retrievePaymentIntent(paymentIntentId) {
      if (!PAYMENT_INTENT_ID.test(paymentIntentId)) {
        throw new PaymentIntentError("invalid_payment_intent_id");
      }
      try {
        return summarizePaymentIntent(await stripe.paymentIntents.retrieve(paymentIntentId));
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === "resource_missing"
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
