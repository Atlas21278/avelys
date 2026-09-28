import "server-only";

import { routingProvider } from "@/integrations/maps";
import { serverEnv } from "@/lib/env/server";
import { getActivePricingRule } from "@/server/pricing/rules";

import { computeQuote, type Quote, type QuoteDeps } from "./quote";

export { QuoteError, type Quote, type QuoteErrorCode, type QuoteRequest } from "./quote";

/** Production wiring: Google Routes, the versioned rule store, the system clock, env config. */
export function quoteDeps(): QuoteDeps {
  return {
    routing: routingProvider(),
    activePricingRule: getActivePricingRule,
    now: () => new Date(),
    minLeadTimeMinutes: serverEnv().BOOKING_MIN_LEAD_TIME_MINUTES,
  };
}

/** Server quote with the production dependencies. */
export function quote(input: unknown): Promise<Quote> {
  return computeQuote(input, quoteDeps());
}
