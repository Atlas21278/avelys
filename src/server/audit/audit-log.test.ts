import { describe, expect, it, vi } from "vitest";

import { AuditLogPayloadError, writeAuditLog, type AuditLogWriter } from "./audit-log";

function writer() {
  const create = vi.fn().mockResolvedValue({});
  return { client: { auditLog: { create } } as unknown as AuditLogWriter, create };
}

const AFTER = {
  bookingRef: "VTC-7K2M9QXB",
  status: "REQUESTED",
  version: 1,
  totalTtcCents: 6_188,
  currency: "EUR",
  pricingRuleVersion: 3,
} as const;

const ENTRY = {
  action: "booking.create",
  actorType: "CUSTOMER",
  actorId: "customer-id",
  entityId: "booking-id",
  before: null,
  after: AFTER,
  correlationId: "corr-12345678",
} as const;

describe("writeAuditLog", () => {
  it("writes a whitelisted booking creation with its entity type and no before state", async () => {
    const { client, create } = writer();
    await writeAuditLog(client, ENTRY);

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: "CUSTOMER",
        actorId: "customer-id",
        entityType: "Booking",
        entityId: "booking-id",
        action: "booking.create",
        before: undefined,
        after: AFTER,
        correlationId: "corr-12345678",
      },
    });
  });

  it.each([
    ["an email", { email: "guest@avelys.test" }],
    ["a name", { customerName: "Guest Test" }],
    ["a phone", { phone: "+33100000000" }],
    ["an address", { pickupLabel: "Gare de Lyon" }],
  ])("refuses %s in the after state and writes nothing", async (_label, extra) => {
    const { client, create } = writer();
    const error: unknown = await writeAuditLog(client, {
      ...ENTRY,
      after: { ...AFTER, ...extra } as typeof AFTER,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuditLogPayloadError);
    expect((error as AuditLogPayloadError).code).toBe("INVALID_AUDIT_PAYLOAD");
    // Paths only: the refused value never reaches the message.
    expect((error as Error).message).not.toContain(Object.values(extra)[0]);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a non-null before state for a creation", async () => {
    const { client, create } = writer();
    await expect(
      writeAuditLog(client, { ...ENTRY, before: AFTER as unknown as null }),
    ).rejects.toBeInstanceOf(AuditLogPayloadError);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a malformed booking reference", async () => {
    const { client } = writer();
    await expect(
      writeAuditLog(client, { ...ENTRY, after: { ...AFTER, bookingRef: "guest@avelys.test" } }),
    ).rejects.toBeInstanceOf(AuditLogPayloadError);
  });

  it("writes a payment creation under the Payment entity type", async () => {
    const { client, create } = writer();
    const after = {
      bookingRef: "VTC-7K2M9QXB",
      status: "PENDING",
      version: 1,
      amountCents: 6_188,
      currency: "EUR",
      attempt: 0,
    } as const;
    await writeAuditLog(client, {
      ...ENTRY,
      action: "payment.create",
      entityId: "payment-id",
      after,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Payment",
        entityId: "payment-id",
        action: "payment.create",
        after,
      }) as unknown,
    });
  });

  it.each([
    ["a payment method id", { stripePaymentMethodId: "pm_Test123" }],
    ["a customer id", { stripeCustomerId: "cus_Test123" }],
    ["a card detail", { last4: "4242" }],
  ])("refuses %s in a payment state (BR-40, BR-60)", async (_label, extra) => {
    const { client, create } = writer();
    await expect(
      writeAuditLog(client, {
        ...ENTRY,
        action: "payment.create",
        entityId: "payment-id",
        after: {
          bookingRef: "VTC-7K2M9QXB",
          status: "PENDING",
          version: 1,
          amountCents: 6_188,
          currency: "EUR",
          attempt: 0,
          ...extra,
        },
      }),
    ).rejects.toBeInstanceOf(AuditLogPayloadError);
    expect(create).not.toHaveBeenCalled();
  });
});
