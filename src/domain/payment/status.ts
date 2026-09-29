/**
 * Payment statuses (docs/product/payments.md, ADR-0006). A Payment carries the PSP state; the
 * Booking only references its current Payment and never duplicates this status (BR-41).
 */

export const PAYMENT_STATUSES = [
  "PENDING",
  "REQUIRES_ACTION",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Status of a Payment at creation: the payment method is saved (SetupIntent succeeded), nothing
 * is charged yet (docs/product/payments.md, step 1).
 */
export const INITIAL_PAYMENT_STATUS = "PENDING" satisfies PaymentStatus;

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}
