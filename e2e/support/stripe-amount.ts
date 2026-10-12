import { FAKE_STRIPE_URL, type StripeMode } from "./env";

/**
 * Amount and currency of a PaymentIntent as Stripe holds it (VTC-048): what was actually asked
 * of the card. Fake mode reads the local fake Stripe API; Stripe test mode reads Stripe's API
 * with the test secret key of the run (never logged).
 */
export async function stripePaymentIntentAmount(
  mode: StripeMode,
  paymentIntentId: string,
): Promise<{ amount: number; currency: string }> {
  const path = `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`;
  const key = process.env.STRIPE_SECRET_KEY_TEST ?? "";
  if (mode !== "fake" && !/^(sk|rk)_test_/.test(key)) {
    throw new Error("STRIPE_SECRET_KEY_TEST is not a test mode key (BR-44)");
  }
  const response =
    mode === "fake"
      ? await fetch(`${FAKE_STRIPE_URL}${path}`)
      : await fetch(`https://api.stripe.com${path}`, {
          headers: { authorization: `Bearer ${key}` },
        });
  if (!response.ok) throw new Error(`PaymentIntent read failed (HTTP ${response.status})`);
  const intent = (await response.json()) as { amount: number; currency: string };
  return { amount: intent.amount, currency: intent.currency.toUpperCase() };
}
