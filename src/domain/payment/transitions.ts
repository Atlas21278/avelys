/**
 * Payment state machine (VTC-031, docs/product/payments.md "Transitions Payment"): a single data
 * table plus pure guards, like the Booking machine (ADR-0008). It only decides; the calling
 * service applies the change and writes the AuditLog in the same transaction.
 *
 * `AUTHORIZED` has no transition: it is reserved for a future authorise/capture flow (ADR-0006).
 * The refund transitions exist in the table, but no refund is implemented (DEC-05).
 */

import { DomainError } from "../errors";
import type { PaymentStatus } from "./status";

export interface PaymentTransition {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
}

function row(from: PaymentStatus, to: PaymentStatus): PaymentTransition {
  return Object.freeze({ from, to });
}

/**
 * Literal transcription of the table of docs/product/payments.md. Any change goes through that
 * document first, reviewed with the owner.
 */
export const PAYMENT_TRANSITIONS: readonly PaymentTransition[] = Object.freeze([
  row("PENDING", "REQUIRES_ACTION"),
  row("PENDING", "PAID"),
  row("PENDING", "FAILED"),
  row("PENDING", "CANCELED"),
  row("REQUIRES_ACTION", "PAID"),
  row("REQUIRES_ACTION", "FAILED"),
  row("REQUIRES_ACTION", "CANCELED"),
  row("FAILED", "REQUIRES_ACTION"),
  row("FAILED", "PAID"),
  row("FAILED", "CANCELED"),
  row("PAID", "PARTIALLY_REFUNDED"),
  row("PAID", "REFUNDED"),
  // A further partial refund keeps the status (the refunded total grows).
  row("PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"),
  row("PARTIALLY_REFUNDED", "REFUNDED"),
]);

/** Raised for any payment transition not in the table. Carries statuses only. */
export class InvalidPaymentTransitionError extends DomainError {
  override readonly name = "InvalidPaymentTransitionError";
  readonly code = "INVALID_PAYMENT_TRANSITION";

  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`Invalid payment transition: ${from} -> ${to}`);
  }
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

/** Throws InvalidPaymentTransitionError unless a Payment may move from `from` to `to`. */
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) throw new InvalidPaymentTransitionError(from, to);
}

/** Statuses a Payment may move to from `from` (empty for a status without exit). */
export function allowedPaymentTransitions(from: PaymentStatus): readonly PaymentStatus[] {
  return PAYMENT_TRANSITIONS.filter((transition) => transition.from === from).map(
    (transition) => transition.to,
  );
}
