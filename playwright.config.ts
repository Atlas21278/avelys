import { e2eConfig } from "./e2e/support/config";

/**
 * End-to-end suite, fake Stripe (VTC-048): `pnpm test:e2e`. Runs locally and in CI without any
 * Stripe or Google key; see docs/process/e2e.md.
 */
export default e2eConfig("fake");
