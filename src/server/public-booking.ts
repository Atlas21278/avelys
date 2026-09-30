import "server-only";

import { serverEnv } from "@/lib/env/server";

/**
 * Exposure switch of the public booking routes (VTC-045): `POST /api/v1/bookings` and
 * `POST /api/v1/payment-setups` exist only when `PUBLIC_BOOKING_ENABLED` is "true". Off by
 * default; production enablement is INFRA-006, after per-IP rate limiting (INFRA-005). Read on
 * each request, before the body, Stripe or the database are touched.
 */
export function publicBookingEnabled(): boolean {
  return serverEnv().PUBLIC_BOOKING_ENABLED;
}
