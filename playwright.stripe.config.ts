import { e2eConfig } from "./e2e/support/config";

/**
 * End-to-end suite against Stripe TEST MODE (VTC-048), opt-in: `pnpm test:e2e:stripe`. Needs
 * STRIPE_SECRET_KEY_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST and STRIPE_WEBHOOK_SECRET_TEST
 * (from `stripe listen`); without them every scenario is reported as skipped. See
 * docs/process/e2e.md.
 */
export default e2eConfig("stripe-test");
