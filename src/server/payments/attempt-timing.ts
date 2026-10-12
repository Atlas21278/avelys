import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { STRIPE_REQUEST_MAX_DURATION_MS } from "@/integrations/stripe";

/**
 * Timing of a charge attempt (VTC-041, docs/product/payments.md "Fenêtre de vol"). Technical
 * values derived from the pinned Stripe client settings, not business rules: they follow those
 * settings automatically and are not configurable.
 *
 * An attempt is reserved (`Payment.updatedAt` = database time) before its PaymentIntent is
 * created. Until it is bound to a PaymentIntent, a manual retry cannot tell an interrupted
 * attempt from one whose creation request is still on its way to Stripe; it therefore waits
 * until that request has certainly either reached Stripe (then listed) or failed for good:
 *
 * - send budget: the creation request is never *sent* later than `CHARGE_SEND_BUDGET_MS` after
 *   the reservation (both services check it right before sending; past it the attempt is left
 *   interrupted, nothing is sent). It covers the Stripe list call the first charge makes
 *   between its reservation and the creation, plus a margin for pauses (GC, lock waits);
 * - in-flight window: send budget + the longest duration of the creation request itself
 *   (`STRIPE_REQUEST_MAX_DURATION_MS`) + a margin.
 *
 * Both instants come from the PostgreSQL clock (`databaseNow`), so the clocks of the application
 * replicas never matter.
 */

/** Margin of the send budget over one Stripe call (pauses between the calls). */
const SEND_MARGIN_MS = 30_000;
/** Margin of the in-flight window (Stripe still processing a request it just received). */
const IN_FLIGHT_MARGIN_MS = 60_000;

/** Longest delay between an attempt's reservation and the sending of its creation request. */
export const CHARGE_SEND_BUDGET_MS = STRIPE_REQUEST_MAX_DURATION_MS + SEND_MARGIN_MS;

/**
 * How long after its reservation an attempt not yet bound to a PaymentIntent is presumed still
 * in flight. Currently 280 s + 250 s + 60 s = 590 s.
 */
export const CHARGE_IN_FLIGHT_GRACE_MS =
  CHARGE_SEND_BUDGET_MS + STRIPE_REQUEST_MAX_DURATION_MS + IN_FLIGHT_MARGIN_MS;

/** Clock of the attempt timing: the database clock in production, injected by tests. */
export type AttemptClock = () => Date | Promise<Date>;

/** Current time of the PostgreSQL server (`clock_timestamp()`, not the transaction start). */
export async function databaseNow(client: Pick<PrismaClient, "$queryRaw">): Promise<Date> {
  const rows = await client.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new Error("database clock unavailable");
  return now;
}

/** Whether the creation request of an attempt reserved at `reservedAt` may still be sent. */
export function withinSendBudget(reservedAt: Date, now: Date): boolean {
  return now.getTime() - reservedAt.getTime() <= CHARGE_SEND_BUDGET_MS;
}
