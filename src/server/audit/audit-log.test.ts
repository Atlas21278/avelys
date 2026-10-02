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

  it.each(["booking.accept", "booking.refuse"] as const)(
    "writes a %s transition with reference, status and version only",
    async (action) => {
      const { client, create } = writer();
      const before = { bookingRef: "VTC-7K2M9QXB", status: "REQUESTED", version: 1 } as const;
      const after = {
        ...before,
        status: action === "booking.accept" ? "ACCEPTED" : "REFUSED",
        version: 2,
      } as const;
      await writeAuditLog(client, {
        action,
        actorType: "DISPATCHER",
        actorId: "user-id",
        entityId: "booking-id",
        before,
        after,
        correlationId: null,
      });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ entityType: "Booking", action, before, after }),
      });
    },
  );

  it("refuses a transition state carrying anything beyond reference, status and version", async () => {
    const { client, create } = writer();
    const before = { bookingRef: "VTC-7K2M9QXB", status: "REQUESTED", version: 1 } as const;
    await expect(
      writeAuditLog(client, {
        action: "booking.refuse",
        actorType: "ADMIN",
        actorId: "user-id",
        entityId: "booking-id",
        before,
        after: {
          ...before,
          status: "REFUSED",
          version: 2,
          reason: "free text",
        } as unknown as typeof before,
        correlationId: null,
      }),
    ).rejects.toBeInstanceOf(AuditLogPayloadError);
    expect(create).not.toHaveBeenCalled();
  });

  describe("charge actions (VTC-033)", () => {
    const paymentBefore = {
      bookingRef: "VTC-7K2M9QXB",
      status: "PENDING",
      version: 2,
      amountCents: 6_188,
      currency: "EUR",
      attempt: 1,
    } as const;

    it("writes a charge outcome with the PaymentIntent id under the Payment entity type", async () => {
      const { client, create } = writer();
      const after = {
        ...paymentBefore,
        status: "PAID",
        version: 3,
        paymentIntentId: "pi_Test123",
      } as const;
      await writeAuditLog(client, {
        action: "payment.charge",
        actorType: "SYSTEM",
        actorId: null,
        entityId: "payment-id",
        before: paymentBefore,
        after,
        correlationId: null,
      });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "Payment",
          action: "payment.charge",
          after,
        }) as unknown,
      });
    });

    it.each([
      ["a malformed PaymentIntent id", { paymentIntentId: "pm_Test123" }],
      ["a payment method id", { paymentIntentId: "pi_Test123", stripePaymentMethodId: "pm_Test1" }],
      ["a customer id", { paymentIntentId: "pi_Test123", stripeCustomerId: "cus_Test1" }],
    ])("refuses %s in a charge outcome", async (_label, extra) => {
      const { client, create } = writer();
      await expect(
        writeAuditLog(client, {
          action: "payment.charge",
          actorType: "SYSTEM",
          actorId: null,
          entityId: "payment-id",
          before: paymentBefore,
          after: { ...paymentBefore, status: "FAILED", version: 3, ...extra },
          correlationId: null,
        }),
      ).rejects.toBeInstanceOf(AuditLogPayloadError);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a PaymentIntent id in a charge attempt reservation", async () => {
      const { client, create } = writer();
      await expect(
        writeAuditLog(client, {
          action: "payment.charge_attempt",
          actorType: "SYSTEM",
          actorId: null,
          entityId: "payment-id",
          before: { ...paymentBefore, attempt: 0, version: 1 },
          after: { ...paymentBefore, paymentIntentId: "pi_Test123" } as typeof paymentBefore,
          correlationId: null,
        }),
      ).rejects.toBeInstanceOf(AuditLogPayloadError);
      expect(create).not.toHaveBeenCalled();
    });

    it("writes a booking confirmation by SYSTEM with reference, status and version", async () => {
      const { client, create } = writer();
      const before = { bookingRef: "VTC-7K2M9QXB", status: "ACCEPTED", version: 2 } as const;
      const after = { ...before, status: "CONFIRMED", version: 3 } as const;
      await writeAuditLog(client, {
        action: "booking.confirm",
        actorType: "SYSTEM",
        actorId: null,
        entityId: "booking-id",
        before,
        after,
        correlationId: null,
      });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "Booking",
          action: "booking.confirm",
          after,
        }) as unknown,
      });
    });
  });

  describe("manual retry (VTC-041)", () => {
    const failed = {
      bookingRef: "VTC-7K2M9QXB",
      status: "FAILED",
      version: 3,
      amountCents: 6_188,
      currency: "EUR",
      attempt: 1,
    } as const;
    const after = { ...failed, version: 4, attempt: 2 } as const;

    it.each([
      ["with the previous PaymentIntent id", { ...failed, paymentIntentId: "pi_Test123" }],
      ["without one (interrupted first attempt)", { ...failed, status: "PENDING" as const }],
    ])("writes a retry by ADMIN %s", async (_label, before) => {
      const { client, create } = writer();
      await writeAuditLog(client, {
        action: "payment.retry",
        actorType: "ADMIN",
        actorId: "user-id",
        entityId: "payment-id",
        before,
        after,
        correlationId: "corr-12345678",
      });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "Payment",
          action: "payment.retry",
          actorType: "ADMIN",
          before,
          after,
        }) as unknown,
      });
    });

    it.each([
      [
        "another Stripe id as previous PaymentIntent",
        { before: { ...failed, paymentIntentId: "pm_Test1" }, after },
      ],
      [
        "a PaymentIntent id after the retry",
        { before: failed, after: { ...after, paymentIntentId: "pi_Test123" } },
      ],
    ])("refuses %s", async (_label, states) => {
      const { client, create } = writer();
      await expect(
        writeAuditLog(client, {
          action: "payment.retry",
          actorType: "ADMIN",
          actorId: "user-id",
          entityId: "payment-id",
          ...(states as { before: typeof failed; after: typeof after }),
          correlationId: null,
        }),
      ).rejects.toBeInstanceOf(AuditLogPayloadError);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
