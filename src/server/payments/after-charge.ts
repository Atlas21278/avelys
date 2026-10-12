import "server-only";

import { logger } from "@/lib/logger";

/**
 * Post-commit port of the charge (VTC-033): called once a Payment has entered
 * `REQUIRES_ACTION`, after the transaction that recorded it has committed (synchronous charge and
 * webhook alike). Its failure is logged and changes nothing (BR-50). Production implementation:
 * the customer email with the regularisation link, `sendPaymentActionRequiredEmailPort`
 * (VTC-044, `action-required-email.ts`), wired by the production entry points; implementations
 * must be idempotent.
 */
export type OnPaymentRequiresAction = (paymentId: string) => Promise<void>;

/** Default when a caller wires no port (tests, tools): nothing is sent. */
export const onPaymentRequiresActionNoop: OnPaymentRequiresAction = async () => {};

/** Runs the port (no-op by default); a failure is logged with the booking reference only. */
export async function runRequiresActionPort(
  port: OnPaymentRequiresAction | undefined,
  paymentId: string,
  bookingRef: string | null,
): Promise<void> {
  try {
    await (port ?? onPaymentRequiresActionNoop)(paymentId);
  } catch (error) {
    logger().error(
      { bookingRef, errorName: error instanceof Error ? error.name : "unknown" },
      "onPaymentRequiresAction failed; the payment stays REQUIRES_ACTION",
    );
  }
}
