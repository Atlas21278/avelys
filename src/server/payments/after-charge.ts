import "server-only";

import { logger } from "@/lib/logger";

/**
 * Post-commit port of the charge (VTC-033): called once a Payment has entered
 * `REQUIRES_ACTION`, after the transaction that recorded it has committed (synchronous charge and
 * webhook alike). Its failure is logged and changes nothing (BR-50). The customer email with the
 * regularisation link plugs in here (VTC-044); implementations must be idempotent.
 */
export type OnPaymentRequiresAction = (paymentId: string) => Promise<void>;

/** Default until VTC-044: nothing is sent. */
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
