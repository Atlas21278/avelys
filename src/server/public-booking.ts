import "server-only";

import type { ServiceArea } from "@/domain/geo/service-area";
import { EnvValidationError } from "@/lib/env/schema";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";

/**
 * Exposure switch of the public booking routes (VTC-045): `POST /api/v1/bookings` and
 * `POST /api/v1/payment-setups` exist only when `PUBLIC_BOOKING_ENABLED` is "true". Off by
 * default; production enablement is INFRA-006, after per-IP rate limiting (INFRA-005). Read on
 * each request, before the body, Stripe or the database are touched.
 */
export function publicBookingEnabled(): boolean {
  return serverEnv().PUBLIC_BOOKING_ENABLED;
}

/** What the public booking page needs to offer the quote step (VTC-046). */
export type PublicQuoteSettings =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      /** Restricted browser key, handed to the browser only; null = no online quote. */
      readonly mapsBrowserKey: string | null;
      /** Autocomplete restriction: the same provisional rectangle as routing (DEC-26). */
      readonly serviceArea: ServiceArea;
    };

/**
 * Settings of the booking page, read at request time. The switch off, or an environment that
 * does not validate, keeps the page on its placeholder: never a 500 for a visitor (the API
 * routes still fail loudly on their own).
 */
export function publicQuoteSettings(): PublicQuoteSettings {
  let env;
  try {
    env = serverEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    logger().error({ errorName: error.name }, "booking page: invalid environment, quote disabled");
    return { enabled: false };
  }
  if (!env.PUBLIC_BOOKING_ENABLED) return { enabled: false };
  return {
    enabled: true,
    mapsBrowserKey: env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY ?? null,
    serviceArea: env.ROUTING_SERVICE_AREA,
  };
}
