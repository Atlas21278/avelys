import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  SETUP_INTENT_ID,
  stripeUnavailableReason,
  type PaymentSetupGateway,
  type SetupIntentSummary,
} from "@/integrations/stripe";
import { logger } from "@/lib/logger";

/**
 * Payment method precondition of `— → REQUESTED` (Master Spec §54.4, docs/product/payments.md
 * step 1): a request is only recorded once the customer has saved a payment method through a
 * Stripe SetupIntent (VTC-031). Nothing is charged here.
 */

export interface PaymentMethodCheck {
  /** SetupIntent id (`seti_…`) sent by the booking form; undefined when the form sent none. */
  readonly paymentSetupId: string | undefined;
  /**
   * Email of the booking request (VTC-045): the SetupIntent's Customer must hold the same one,
   * normalised (trim + lower case). Never logged.
   */
  readonly email: string;
}

/** Stripe references of a confirmed payment method, stored on the booking's first Payment. */
export type ConfirmedPaymentMethod = Readonly<{
  setupIntentId: string;
  customerId: string;
  paymentMethodId: string;
}>;

export interface PaymentMethodGuard {
  /**
   * The references of a payment method confirmed and usable off-session, or null. Never
   * charges. The single use of a SetupIntent is finally enforced by the unique constraint on
   * `Payment.stripeSetupIntentId` inside the creation transaction.
   */
  confirmedPaymentMethod(check: PaymentMethodCheck): Promise<ConfirmedPaymentMethod | null>;
}

/** Why a payment setup is refused (logged; never an id, an email or a card detail). */
export type PaymentMethodRefusal =
  | "missing"
  | "malformed"
  | "already_used"
  | "unknown"
  | "live_mode"
  | "foreign_flow"
  | "not_succeeded"
  | "wrong_usage"
  | "no_customer"
  | "no_payment_method"
  | "payment_setup_email_mismatch";

/**
 * Stripe cannot be used to check the payment method (outage, network, missing or non-test key).
 * Not a refusal: the request may be retried. Carries a reason tag only, never the Stripe error
 * (its message or payload may quote the request).
 */
export class PaymentMethodUnavailableError extends Error {
  override readonly name = "PaymentMethodUnavailableError";

  constructor(readonly reason: string) {
    super(`Payment method check unavailable: ${reason}`);
  }
}

/** Trim + lower case, as `ContactEmailSchema` stores it. */
function normalisedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface StripePaymentMethodGuardDeps {
  /** Resolved on use only: building the guard reads no environment. */
  readonly gateway: () => PaymentSetupGateway;
  readonly db: Pick<PrismaClient, "payment">;
}

/**
 * Production guard: the SetupIntent is read back from Stripe (the browser's word is never
 * trusted) and must be `succeeded`, `usage: off_session`, created by the booking request flow,
 * in test mode, with a Customer holding the request's email and a payment method, and not
 * already used by a booking. A Stripe outage or a missing test key is not a refusal: it raises
 * `PaymentMethodUnavailableError`, without the Stripe error. Any other failure propagates.
 */
export function createStripePaymentMethodGuard(
  deps: StripePaymentMethodGuardDeps,
): PaymentMethodGuard {
  const refuse = (reason: PaymentMethodRefusal): null => {
    logger().info({ reason }, "payment method refused");
    return null;
  };

  return {
    async confirmedPaymentMethod({ paymentSetupId, email }) {
      if (paymentSetupId === undefined) return refuse("missing");
      if (!SETUP_INTENT_ID.test(paymentSetupId)) return refuse("malformed");

      const used = await deps.db.payment.findUnique({
        where: { stripeSetupIntentId: paymentSetupId },
        select: { id: true },
      });
      if (used) return refuse("already_used");

      let setupIntent: SetupIntentSummary | null;
      try {
        setupIntent = await deps.gateway().retrieveSetupIntent(paymentSetupId);
      } catch (error) {
        const reason = stripeUnavailableReason(error);
        if (reason === null) throw error;
        throw new PaymentMethodUnavailableError(reason);
      }
      if (!setupIntent) return refuse("unknown");
      if (setupIntent.livemode) return refuse("live_mode");
      if (!setupIntent.fromBookingRequestFlow) return refuse("foreign_flow");
      if (setupIntent.status !== "succeeded") return refuse("not_succeeded");
      if (setupIntent.usage !== "off_session") return refuse("wrong_usage");
      if (!setupIntent.customerId) return refuse("no_customer");
      if (!setupIntent.paymentMethodId) return refuse("no_payment_method");
      // The card was saved for this email's request only (VTC-045): a SetupIntent obtained for
      // one address cannot back a request made under another.
      if (
        setupIntent.customerEmail === null ||
        normalisedEmail(setupIntent.customerEmail) !== normalisedEmail(email)
      ) {
        return refuse("payment_setup_email_mismatch");
      }

      return {
        setupIntentId: setupIntent.id,
        customerId: setupIntent.customerId,
        paymentMethodId: setupIntent.paymentMethodId,
      };
    },
  };
}
