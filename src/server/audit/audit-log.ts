import "server-only";

import { z } from "zod";

import { isValidReference } from "@/domain/booking/reference";
import { BOOKING_STATUSES } from "@/domain/booking/status";
import type { BookingActor } from "@/domain/booking/transitions";
import { PAYMENT_STATUSES } from "@/domain/payment/status";
import type { Prisma } from "@/generated/prisma/client";
import { CURRENCIES } from "@/lib/money";

/**
 * AuditLog writer (BR-30, BR-60). `before` and `after` go through a per-action whitelist: strict
 * Zod schemas, so any key outside the list (a name, an email, a phone, an address) is refused
 * and nothing is written. A booking is identified by its public reference (`bookingRef`), never
 * by customer data. The trail is append-only: this module only inserts.
 */

/** Booking state recorded in the trail: reference, status, version and priced amount only. */
export const BookingAuditStateSchema = z.strictObject({
  bookingRef: z.string().refine(isValidReference, "Invalid booking reference"),
  status: z.enum(BOOKING_STATUSES),
  version: z.int().positive(),
  totalTtcCents: z.int().nonnegative(),
  currency: z.enum(CURRENCIES),
  pricingRuleVersion: z.int().positive(),
});

/**
 * Payment state recorded in the trail: booking reference, status, version, amount and attempts.
 * No Stripe id: the payment method id in particular identifies a card (BR-60).
 */
export const PaymentAuditStateSchema = z.strictObject({
  bookingRef: z.string().refine(isValidReference, "Invalid booking reference"),
  status: z.enum(PAYMENT_STATUSES),
  version: z.int().positive(),
  amountCents: z.int().nonnegative(),
  currency: z.enum(CURRENCIES),
  attempt: z.int().nonnegative(),
});

/**
 * Payment state after a charge attempt (VTC-033): the payment state plus the id of the attempt's
 * PaymentIntent. Documented exception to "no Stripe id" (docs/product/payments.md): a `pi_…` id
 * is neither card data, nor personal data, nor a secret, and traces each attempt. Format checked;
 * every other Stripe id stays refused.
 */
export const PaymentChargeAuditStateSchema = PaymentAuditStateSchema.extend({
  paymentIntentId: z
    .string()
    .max(255)
    .regex(/^pi_[A-Za-z0-9]+$/),
});

/**
 * Payment state before a manual retry (VTC-041): the payment state plus, when the previous
 * attempt reached Stripe, its PaymentIntent id (same documented exception as `payment.charge`).
 */
export const PaymentRetryAuditStateSchema = PaymentAuditStateSchema.extend({
  paymentIntentId: PaymentChargeAuditStateSchema.shape.paymentIntentId.optional(),
});

/** Booking state recorded for a status transition (VTC-032): reference, status and version only. */
export const BookingTransitionAuditStateSchema = BookingAuditStateSchema.pick({
  bookingRef: true,
  status: true,
  version: true,
});

/** Whitelist: one entry per audited action, with its entity type and before/after schemas. */
const AUDIT_ACTIONS = {
  /** `— → REQUESTED` (VTC-028). */
  "booking.create": {
    entityType: "Booking",
    before: z.null(),
    after: BookingAuditStateSchema,
  },
  /** First Payment of a booking, `PENDING`, created with it (VTC-031). */
  "payment.create": {
    entityType: "Payment",
    before: z.null(),
    after: PaymentAuditStateSchema,
  },
  /** `REQUESTED → ACCEPTED` (VTC-032). */
  "booking.accept": {
    entityType: "Booking",
    before: BookingTransitionAuditStateSchema,
    after: BookingTransitionAuditStateSchema,
  },
  /** `REQUESTED → REFUSED` (VTC-032). */
  "booking.refuse": {
    entityType: "Booking",
    before: BookingTransitionAuditStateSchema,
    after: BookingTransitionAuditStateSchema,
  },
  /** `ACCEPTED → CONFIRMED` by SYSTEM once the charge succeeded (VTC-033). */
  "booking.confirm": {
    entityType: "Booking",
    before: BookingTransitionAuditStateSchema,
    after: BookingTransitionAuditStateSchema,
  },
  /** Charge attempt reserved on the Payment (`attempt` + 1) before Stripe is called (VTC-033). */
  "payment.charge_attempt": {
    entityType: "Payment",
    before: PaymentAuditStateSchema,
    after: PaymentAuditStateSchema,
  },
  /** Outcome of a charge attempt applied to the Payment, with its PaymentIntent id (VTC-033). */
  "payment.charge": {
    entityType: "Payment",
    before: PaymentAuditStateSchema,
    after: PaymentChargeAuditStateSchema,
  },
  /**
   * Manual retry reserved by an owner (VTC-041): `attempt` + 1, the PaymentIntent of the previous
   * attempt (if any) kept in `before` since the Payment row forgets it.
   */
  "payment.retry": {
    entityType: "Payment",
    before: PaymentRetryAuditStateSchema,
    after: PaymentAuditStateSchema,
  },
} as const satisfies Record<
  string,
  { entityType: string; before: z.ZodType; after: z.ZodType<Prisma.InputJsonValue | null> }
>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditEntry<A extends AuditAction> = Readonly<{
  action: A;
  actorType: BookingActor;
  /** User id for staff and drivers, Customer id for customers, null for SYSTEM. */
  actorId: string | null;
  entityId: string;
  before: z.input<(typeof AUDIT_ACTIONS)[A]["before"]>;
  after: z.input<(typeof AUDIT_ACTIONS)[A]["after"]>;
  correlationId: string | null;
}>;

/** Any client able to insert an audit row: the Prisma client or a transaction client. */
export type AuditLogWriter = Pick<Prisma.TransactionClient, "auditLog">;

/** Raised before any write when a payload leaves the whitelist. Carries paths, never values. */
export class AuditLogPayloadError extends Error {
  override readonly name = "AuditLogPayloadError";
  readonly code = "INVALID_AUDIT_PAYLOAD";
}

function parsePart<T>(schema: z.ZodType<T>, value: unknown, part: string, action: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${[part, ...issue.path].join(".")}: ${issue.code}`)
      .join("; ");
    throw new AuditLogPayloadError(`Invalid audit payload for ${action}: ${issues}`);
  }
  return result.data;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  // `null` means "no state" (e.g. before a creation): the column stays SQL NULL.
  return value === null ? undefined : (value as Prisma.InputJsonValue);
}

/**
 * Validates `before`/`after` against the whitelist of `entry.action`, then inserts the row.
 * Call it with the transaction client of the change it records, so that both commit together.
 */
export async function writeAuditLog<A extends AuditAction>(
  client: AuditLogWriter,
  entry: AuditEntry<A>,
): Promise<void> {
  const spec = AUDIT_ACTIONS[entry.action];
  const before = parsePart(spec.before as z.ZodType, entry.before, "before", entry.action);
  const after = parsePart(spec.after as z.ZodType, entry.after, "after", entry.action);

  await client.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId,
      entityType: spec.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: toJson(before),
      after: toJson(after),
      correlationId: entry.correlationId,
    },
  });
}
