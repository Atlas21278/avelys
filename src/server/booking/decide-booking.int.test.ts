import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookingStatus } from "@/domain/booking/status";
import { InvalidBookingTransitionError } from "@/domain/booking/transitions";
import { logger } from "@/lib/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { db } from "@/server/db";
import { enrolTotp, signIn, staff } from "@/test/staff-session";

import type * as AuditLogModule from "@/server/audit/audit-log";

import { acceptBooking, BookingDecisionError, refuseBooking } from "./decide-booking";
import { runBookingDecision } from "./decision-action";
import { generateReference } from "./reference";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Bookings are inserted directly as REQUESTED rows: creation is covered by VTC-028.

// Audit failure switch: wraps the real writer so a test can make it throw inside the transaction.
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/audit/audit-log", async (importOriginal) => {
  const actual = await importOriginal<typeof AuditLogModule>();
  return {
    ...actual,
    writeAuditLog: (async (...args) => {
      if (audit.fail) throw new Error("audit store unavailable");
      return actual.writeAuditLog(...args);
    }) satisfies typeof actual.writeAuditLog,
  };
});

// Referenced by Booking (composite foreign key, VTC-025). Test row only: its config is not a tariff.
const TEST_RULE = { id: "test-rule-decide-booking", version: 1 } as const;

const sessions = {
  admin: new Headers(),
  dispatcher: new Headers(),
  driver: new Headers(),
  customer: new Headers(),
  unenrolled: new Headers(),
};
const userIds = { admin: "", dispatcher: "" };
let customerId = "";

async function resetBookings() {
  const client = db();
  await client.auditLog.deleteMany();
  await client.payment.deleteMany();
  await client.notification.deleteMany();
  await client.booking.deleteMany();
  await client.customer.deleteMany();
  await client.pricingRule.deleteMany();
}

async function resetUsers() {
  const client = db();
  await client.session.deleteMany();
  await client.account.deleteMany();
  await client.twoFactor.deleteMany();
  await client.verification.deleteMany();
  await client.rateLimit.deleteMany();
  await client.user.deleteMany();
}

async function booking(status: BookingStatus = "REQUESTED") {
  const pickupAt = new Date("2026-11-02T09:00:00Z");
  return db().booking.create({
    data: {
      reference: generateReference(),
      customerId,
      pickupLabel: "Gare de Lyon, Paris",
      pickupLat: 48.844_3,
      pickupLng: 2.374_3,
      dropoffLabel: "Aéroport Paris-Charles de Gaulle",
      dropoffLat: 49.009_7,
      dropoffLng: 2.547_9,
      pickupAt,
      pickupLocalDateTime: pickupAt,
      passengerCount: 2,
      luggageCount: 1,
      quotedDistanceMeters: 31_250,
      quotedDurationSeconds: 2_400,
      // Test values only, not a tariff.
      totalTtcCents: 12_345,
      currency: "EUR",
      pricingSnapshot: { schemaVersion: 1, note: "test snapshot" },
      pricingRuleId: TEST_RULE.id,
      pricingRuleVersion: TEST_RULE.version,
      status,
    },
    select: { id: true, reference: true, version: true },
  });
}

async function state(id: string) {
  return db().booking.findUniqueOrThrow({
    where: { id },
    select: { status: true, version: true },
  });
}

async function auditRows(id: string) {
  return db().auditLog.findMany({
    where: { entityType: "Booking", entityId: id },
    orderBy: { createdAt: "asc" },
  });
}

const admin = () => ({ role: "ADMIN" as const, userId: userIds.admin });
const dispatcher = () => ({ role: "DISPATCHER" as const, userId: userIds.dispatcher });

describe("booking decision (integration)", () => {
  beforeAll(async () => {
    await resetBookings();
    await resetUsers();

    for (const role of ["ADMIN", "DISPATCHER"] as const) {
      const { jar } = await signIn(await staff(role));
      await enrolTotp(jar);
      sessions[role === "ADMIN" ? "admin" : "dispatcher"] = jar.headers();
    }
    sessions.driver = (await signIn(await staff("DRIVER"))).jar.headers();
    sessions.unenrolled = (
      await signIn(await staff("ADMIN", "fresh-admin@avelys.test"))
    ).jar.headers();
    // A CUSTOMER account with a password session: only staff can be created by the helper,
    // so the role is lowered in the database before signing in.
    const customerEmail = await staff("DRIVER", "customer-account@avelys.test");
    await db().user.update({ where: { email: customerEmail }, data: { role: "CUSTOMER" } });
    sessions.customer = (await signIn(customerEmail)).jar.headers();

    const users = await db().user.findMany({ select: { id: true, email: true } });
    const idOf = (email: string) => users.find((user) => user.email === email)?.id ?? "";
    userIds.admin = idOf("admin@avelys.test");
    userIds.dispatcher = idOf("dispatcher@avelys.test");
  });

  beforeEach(async () => {
    audit.fail = false;
    await resetBookings();
    await db().pricingRule.create({
      data: {
        ...TEST_RULE,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        config: { note: "test rule, not a tariff" },
        schemaVersion: 1,
      },
    });
    customerId = (
      await db().customer.create({
        data: { name: "Client Test", email: "client@avelys.test", phone: "+33100000000" },
      })
    ).id;
  });

  afterAll(async () => {
    audit.fail = false;
    await resetBookings();
    await resetUsers();
    await db().$disconnect();
  });

  describe("service", () => {
    it.each([
      ["ADMIN", "accept", admin, "ACCEPTED"],
      ["ADMIN", "refuse", admin, "REFUSED"],
      ["DISPATCHER", "accept", dispatcher, "ACCEPTED"],
      ["DISPATCHER", "refuse", dispatcher, "REFUSED"],
    ] as const)(
      "%s can %s a REQUESTED booking, audited in the same transaction",
      async (_r, verb, actor, to) => {
        const row = await booking();
        const decide = verb === "accept" ? acceptBooking : refuseBooking;

        const decided = await runWithRequestContext({ correlationId: "corr-decide-0001" }, () =>
          decide(row.reference, row.version, actor()),
        );

        expect(decided).toEqual({
          bookingId: row.id,
          reference: row.reference,
          status: to,
          version: 2,
        });
        expect(await state(row.id)).toEqual({ status: to, version: 2 });

        const [entry, ...others] = await auditRows(row.id);
        expect(others).toHaveLength(0);
        expect(entry).toMatchObject({
          actorType: actor().role,
          actorId: actor().userId,
          entityType: "Booking",
          action: verb === "accept" ? "booking.accept" : "booking.refuse",
          before: { bookingRef: row.reference, status: "REQUESTED", version: 1 },
          after: { bookingRef: row.reference, status: to, version: 2 },
          correlationId: "corr-decide-0001",
        });
      },
    );

    const otherStatuses: BookingStatus[] = [
      "ACCEPTED",
      "REFUSED",
      "CANCELLED",
      "CONFIRMED",
      "DRIVER_ASSIGNED",
      "IN_PROGRESS",
      "NO_SHOW",
      "COMPLETED",
    ];
    for (const status of otherStatuses) {
      it(`refuses to accept or refuse a ${status} booking and writes nothing`, async () => {
        const row = await booking(status);
        for (const decide of [acceptBooking, refuseBooking]) {
          await expect(decide(row.reference, row.version, admin())).rejects.toBeInstanceOf(
            InvalidBookingTransitionError,
          );
        }
        expect(await state(row.id)).toEqual({ status, version: 1 });
        expect(await auditRows(row.id)).toHaveLength(0);
      });
    }

    it.each(["DRIVER", "CUSTOMER", "SYSTEM"] as const)(
      "refuses a %s actor even if a caller skipped the access check",
      async (role) => {
        const row = await booking();
        await expect(
          acceptBooking(row.reference, row.version, { role, userId: "someone" }),
        ).rejects.toMatchObject({ code: "INVALID_BOOKING_TRANSITION" });
        await expect(
          refuseBooking(row.reference, row.version, { role, userId: "someone" }),
        ).rejects.toMatchObject({ code: "INVALID_BOOKING_TRANSITION" });
        expect(await state(row.id)).toEqual({ status: "REQUESTED", version: 1 });
        expect(await auditRows(row.id)).toHaveLength(0);
      },
    );

    it("refuses a stale version with BOOKING_CONCURRENT_UPDATE and writes nothing", async () => {
      const row = await booking();
      // Another write of the booking service bumped the version (status unchanged).
      await db().booking.update({ where: { id: row.id }, data: { version: 2 } });

      const error: unknown = await acceptBooking(row.reference, 1, admin()).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(BookingDecisionError);
      expect(error).toMatchObject({ code: "BOOKING_CONCURRENT_UPDATE" });
      expect(await state(row.id)).toEqual({ status: "REQUESTED", version: 2 });
      expect(await auditRows(row.id)).toHaveLength(0);
    });

    it("reports an unknown booking as BOOKING_NOT_FOUND", async () => {
      await expect(acceptBooking(generateReference(), 1, admin())).rejects.toMatchObject({
        code: "BOOKING_NOT_FOUND",
      });
    });

    it("lets exactly one of two concurrent decisions succeed", async () => {
      const rows = await Promise.all([booking(), booking(), booking(), booking(), booking()]);
      for (const row of rows) {
        const results = await Promise.allSettled([
          acceptBooking(row.reference, row.version, admin()),
          refuseBooking(row.reference, row.version, dispatcher()),
        ]);
        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result) => result.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          code: expect.stringMatching(/^(BOOKING_CONCURRENT_UPDATE|INVALID_BOOKING_TRANSITION)$/),
        });

        const winner = (fulfilled[0] as PromiseFulfilledResult<{ status: BookingStatus }>).value;
        expect(await state(row.id)).toEqual({ status: winner.status, version: 2 });
        expect(await auditRows(row.id)).toHaveLength(1);
      }
    });

    it("rolls the transition back when the audit row cannot be written", async () => {
      const row = await booking();
      audit.fail = true;
      await expect(acceptBooking(row.reference, row.version, admin())).rejects.toThrow(
        "audit store unavailable",
      );
      audit.fail = false;
      expect(await state(row.id)).toEqual({ status: "REQUESTED", version: 1 });
      expect(await auditRows(row.id)).toHaveLength(0);
    });

    it("keeps the booking ACCEPTED when onBookingAccepted fails", async () => {
      const row = await booking();
      const onBookingAccepted = vi.fn().mockRejectedValue(new Error("charge port down"));

      const decided = await acceptBooking(row.reference, row.version, admin(), {
        onBookingAccepted,
      });

      expect(onBookingAccepted).toHaveBeenCalledExactlyOnceWith(row.id);
      expect(decided.status).toBe("ACCEPTED");
      expect(await state(row.id)).toEqual({ status: "ACCEPTED", version: 2 });
      expect(await auditRows(row.id)).toHaveLength(1);
    });

    it("logs the booking reference and statuses only, never customer data (BR-60)", async () => {
      const log = logger();
      const spies = (["info", "warn", "error"] as const).map((level) => vi.spyOn(log, level));
      try {
        const row = await booking();
        await acceptBooking(row.reference, row.version, admin(), {
          onBookingAccepted: () => Promise.reject(new Error("charge port down")),
        });
        await refuseBooking(row.reference, row.version, admin()).catch(() => undefined);

        const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
        expect(logged).toContain(row.reference);
        for (const personal of [
          "Client Test",
          "client@avelys.test",
          "+33100000000",
          "Gare de Lyon",
        ]) {
          expect(logged).not.toContain(personal);
        }
        expect(spies[2]?.mock.calls[0]?.[0]).toEqual({
          bookingRef: row.reference,
          errorName: "Error",
        });
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it("never calls onBookingAccepted for a refusal", async () => {
      const row = await booking();
      const onBookingAccepted = vi.fn();
      await refuseBooking(row.reference, row.version, admin(), { onBookingAccepted });
      expect(onBookingAccepted).not.toHaveBeenCalled();
    });
  });

  describe("action body (session, role and 2FA re-checked)", () => {
    it.each([
      ["ADMIN", () => sessions.admin, "ACCEPTED"],
      ["DISPATCHER", () => sessions.dispatcher, "REFUSED"],
    ] as const)(
      "applies a decision for %s and records the session user",
      async (role, headers, to) => {
        const row = await booking();
        const result = await runBookingDecision(headers(), to, {
          // Tolerant input: lower case, as typed.
          reference: row.reference.toLowerCase(),
          expectedVersion: String(row.version),
        });

        expect(result).toEqual({ ok: true, reference: row.reference, status: to, version: 2 });
        const [entry] = await auditRows(row.id);
        expect(entry?.actorType).toBe(role);
        expect(entry?.actorId).toBe(role === "ADMIN" ? userIds.admin : userIds.dispatcher);
        expect(entry?.correlationId).toEqual(expect.any(String));
      },
    );

    it.each([
      ["no session", () => new Headers()],
      ["a DRIVER", () => sessions.driver],
      ["a CUSTOMER", () => sessions.customer],
      ["an ADMIN without 2FA", () => sessions.unenrolled],
    ] as const)("refuses %s with ACCESS_DENIED and writes nothing", async (_label, headers) => {
      const row = await booking();
      for (const decision of ["ACCEPTED", "REFUSED"] as const) {
        const result = await runBookingDecision(headers(), decision, {
          reference: row.reference,
          expectedVersion: "1",
        });
        expect(result).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
      }
      expect(await state(row.id)).toEqual({ status: "REQUESTED", version: 1 });
      expect(await auditRows(row.id)).toHaveLength(0);
    });

    it("uses the incoming request id as correlationId of the error", async () => {
      const headers = new Headers(sessions.admin);
      headers.set("x-request-id", "req-abcdef123456");
      const result = await runBookingDecision(headers, "ACCEPTED", {
        reference: "VTC-00000000",
        expectedVersion: "1",
      });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "BOOKING_NOT_FOUND",
          message: expect.any(String),
          correlationId: "req-abcdef123456",
        },
      });
    });

    it.each([
      ["a malformed reference", { reference: "not a reference", expectedVersion: "1" }],
      ["a missing version", { reference: "VTC-00000000" }],
      ["extra fields", { reference: "VTC-00000000", expectedVersion: "1", status: "ACCEPTED" }],
    ])("answers INVALID_INPUT for %s", async (_label, input) => {
      const result = await runBookingDecision(sessions.admin, "ACCEPTED", input);
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    });

    it("maps a stale version and an already decided booking to their codes", async () => {
      const row = await booking();
      const first = await runBookingDecision(sessions.admin, "ACCEPTED", {
        reference: row.reference,
        expectedVersion: "1",
      });
      expect(first.ok).toBe(true);

      const again = await runBookingDecision(sessions.dispatcher, "REFUSED", {
        reference: row.reference,
        expectedVersion: "1",
      });
      expect(again).toMatchObject({ ok: false, error: { code: "INVALID_BOOKING_TRANSITION" } });

      const other = await booking();
      await db().booking.update({ where: { id: other.id }, data: { version: 5 } });
      const stale = await runBookingDecision(sessions.dispatcher, "REFUSED", {
        reference: other.reference,
        expectedVersion: "4",
      });
      expect(stale).toMatchObject({ ok: false, error: { code: "BOOKING_CONCURRENT_UPDATE" } });
      expect(await state(other.id)).toEqual({ status: "REQUESTED", version: 5 });
    });
  });
});
