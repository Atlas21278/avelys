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
});
