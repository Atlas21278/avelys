/**
 * Payment method precondition of `— → REQUESTED` (Master Spec §54.4, docs/product/payments.md
 * step 1): a request is only recorded once the customer has a confirmed payment method (Stripe
 * SetupIntent, EPIC-10). This file is the port only; VTC-031 implements it with Stripe.
 */

export interface PaymentMethodCheck {
  /**
   * Opaque reference supplied by the booking form (the SetupIntent id once VTC-031 lands).
   * Undefined when the form sent none.
   */
  readonly paymentSetupId: string | undefined;
}

export interface PaymentMethodGuard {
  /** True only when a payment method is confirmed and usable off-session. Never charges. */
  hasConfirmedPaymentMethod(check: PaymentMethodCheck): Promise<boolean>;
}

/**
 * Production stand-in until VTC-031: fails closed. With it no booking can be created, which is
 * the intended state while no SetupIntent exists (no real booking before EPIC-10).
 */
export const paymentMethodGuardNotConfigured: PaymentMethodGuard = Object.freeze({
  hasConfirmedPaymentMethod: () => Promise.resolve(false),
});
