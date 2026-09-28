import "server-only";

import { z } from "zod";

import { isValidReference } from "@/domain/booking/reference";
import { BOOKING_STATUSES } from "@/domain/booking/status";
import type { BookingActor } from "@/domain/booking/transitions";
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

/** Whitelist: one entry per audited action, with its entity type and before/after schemas. */
const AUDIT_ACTIONS = {
  /** `— → REQUESTED` (VTC-028). */
  "booking.create": {
    entityType: "Booking",
    before: z.null(),
    after: BookingAuditStateSchema,
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
