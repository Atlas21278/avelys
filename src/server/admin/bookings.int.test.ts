import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BookingStatus } from "@/domain/booking/status";
import type { Prisma } from "@/generated/prisma/client";
import { generateReference } from "@/server/booking/reference";
import { db } from "@/server/db";
import { enrolTotp, signIn, staff } from "@/test/staff-session";

import { BOOKING_LIST_PAGE_SIZE, parseBookingListQuery } from "./booking-list-query";
import { BackOfficeAccessError, getBackOfficeBooking, listBackOfficeBookings } from "./bookings";

// Runs against the real test database (vitest "integration" project), migrations applied.

// Referenced by Booking (composite foreign key, VTC-025). Test row only: its config is not a tariff.
const TEST_RULE = { id: "test-rule-back-office", version: 1 } as const;

const sessions: Record<"admin" | "dispatcher" | "driver" | "unenrolled", Headers> = {
  admin: new Headers(),
  dispatcher: new Headers(),
  driver: new Headers(),
  unenrolled: new Headers(),
};
let adminUserId = "";

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

let customerId = "";

async function booking(
  status: BookingStatus,
  pickupAt: string,
  extra: Partial<Prisma.BookingUncheckedCreateInput> = {},
) {
  const instant = new Date(pickupAt);
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
      pickupAt: instant,
      // Test data: the wall-clock column is not read by the back-office.
      pickupLocalDateTime: instant,
      passengerCount: 2,
      luggageCount: 1,
      quotedDistanceMeters: 31_250,
      quotedDurationSeconds: 2_400,
      // Test values only, not a tariff. HT and VAT stay null while DEC-04 is open.
      totalTtcCents: 12_345,
      currency: "EUR",
      pricingSnapshot: { schemaVersion: 1, note: "test snapshot" },
      pricingRuleId: TEST_RULE.id,
      pricingRuleVersion: TEST_RULE.version,
      status,
      ...extra,
    },
    select: { id: true, reference: true },
  });
}

const list = (headers: Headers, params: Record<string, string | string[]> = {}) =>
  listBackOfficeBookings(headers, parseBookingListQuery(params));

describe("back-office bookings (integration)", () => {
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
    adminUserId = (await db().user.findUniqueOrThrow({ where: { email: "admin@avelys.test" } })).id;
  });

  beforeEach(async () => {
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
    // Leave no booking or account behind for the other integration files.
    await resetBookings();
    await resetUsers();
    await db().$disconnect();
  });

  describe("authorization at the function level", () => {
    const denied = [
      ["no session", () => new Headers(), "UNAUTHENTICATED"],
      ["DRIVER", () => sessions.driver, "FORBIDDEN"],
      ["ADMIN without 2FA", () => sessions.unenrolled, "TWO_FACTOR_REQUIRED"],
    ] as const;

    for (const [label, headers, reason] of denied) {
      it(`refuses the list and the detail to ${label}`, async () => {
        const { reference } = await booking("REQUESTED", "2026-11-02T09:00:00Z");
        await expect(list(headers())).rejects.toMatchObject({
          name: "BackOfficeAccessError",
          reason,
        });
        await expect(getBackOfficeBooking(headers(), reference)).rejects.toBeInstanceOf(
          BackOfficeAccessError,
        );
      });
    }

    it("allows ADMIN and DISPATCHER with 2FA", async () => {
      const { reference } = await booking("REQUESTED", "2026-11-02T09:00:00Z");
      for (const headers of [sessions.admin, sessions.dispatcher]) {
        await expect(list(headers)).resolves.toMatchObject({ total: 1 });
        await expect(getBackOfficeBooking(headers, reference)).resolves.toMatchObject({
          reference,
        });
      }
    });
  });

  describe("list", () => {
    it("shows REQUESTED first, then the other statuses, each by pickup instant", async () => {
      const late = await booking("REQUESTED", "2026-11-20T09:00:00Z");
      const confirmedEarly = await booking("CONFIRMED", "2026-11-01T09:00:00Z");
      const early = await booking("REQUESTED", "2026-11-05T09:00:00Z");
      const acceptedMid = await booking("ACCEPTED", "2026-11-03T09:00:00Z");
      const cancelled = await booking("CANCELLED", "2026-10-30T09:00:00Z");

      const page = await list(sessions.admin);
      expect(page.items.map((item) => item.reference)).toEqual([
        early.reference,
        late.reference,
        cancelled.reference,
        confirmedEarly.reference,
        acceptedMid.reference,
      ]);
      expect(page).toMatchObject({ total: 5, page: 1, pageCount: 1 });
    });

    it("returns minimal rows: no snapshot, no coordinates, contact name only", async () => {
      await booking("REQUESTED", "2026-11-02T09:00:00Z");
      const [item] = (await list(sessions.admin)).items;
      expect(item && Object.keys(item).sort()).toEqual(
        [
          "contactName",
          "currency",
          "dropoffLabel",
          "luggageCount",
          "passengerCount",
          "pickupAt",
          "pickupLabel",
          "reference",
          "status",
          "totalTtcCents",
        ].sort(),
      );
      // No contact copy on this row (created as before VTC-037): the customer name is used.
      expect(item).toMatchObject({ contactName: "Client Test", totalTtcCents: 12_345 });
    });

    it("shows the booking's own contact name rather than the customer's (VTC-038)", async () => {
      await booking("REQUESTED", "2026-11-02T09:00:00Z", {
        contactName: "Autre Nom",
        contactPhone: "+33199999999",
        contactLocale: "en",
      });
      const [item] = (await list(sessions.admin)).items;
      expect(item?.contactName).toBe("Autre Nom");
      expect(item).not.toHaveProperty("contactPhone");
      expect(item).not.toHaveProperty("contactLocale");
    });

    it("paginates on the server across the REQUESTED boundary", async () => {
      const size = BOOKING_LIST_PAGE_SIZE;
      const requested = size + 3;
      const others = 5;
      const base = Date.parse("2026-11-01T06:00:00Z");
      for (let i = 0; i < requested; i += 1) {
        await booking("REQUESTED", new Date(base + i * 3_600_000).toISOString());
      }
      for (let i = 0; i < others; i += 1) {
        // Earlier than every REQUESTED booking: still listed after them.
        await booking("CONFIRMED", new Date(base - (i + 1) * 3_600_000).toISOString());
      }

      const first = await list(sessions.admin);
      expect(first.items).toHaveLength(size);
      expect(first).toMatchObject({ total: requested + others, pageCount: 2 });
      expect(first.items.every((item) => item.status === "REQUESTED")).toBe(true);

      const second = await list(sessions.admin, { page: "2" });
      expect(second.items.map((item) => item.status)).toEqual([
        ...Array<string>(requested - size).fill("REQUESTED"),
        ...Array<string>(others).fill("CONFIRMED"),
      ]);
      const pickups = second.items.slice(requested - size).map((item) => item.pickupAt.getTime());
      expect(pickups).toEqual([...pickups].sort((a, b) => a - b));

      const all = [...first.items, ...second.items].map((item) => item.reference);
      expect(new Set(all).size).toBe(requested + others);

      await expect(list(sessions.admin, { page: "3" })).resolves.toMatchObject({ items: [] });
    });

    it("filters by status", async () => {
      await booking("REQUESTED", "2026-11-02T09:00:00Z");
      const accepted = await booking("ACCEPTED", "2026-11-03T09:00:00Z");
      const refused = await booking("REFUSED", "2026-11-04T09:00:00Z");

      const page = await list(sessions.dispatcher, { status: ["REFUSED", "ACCEPTED"] });
      expect(page.items.map((item) => item.reference)).toEqual([
        accepted.reference,
        refused.reference,
      ]);
      expect(page.total).toBe(2);

      await expect(list(sessions.dispatcher, { status: "REQUESTED" })).resolves.toMatchObject({
        total: 1,
      });
    });

    it("filters by Paris pickup days, including the 25-hour day of late October", async () => {
      // 2026-10-25 in Paris runs from 2026-10-24T22:00Z to 2026-10-25T23:00Z.
      const before = await booking("REQUESTED", "2026-10-24T21:59:00Z");
      const firstMinute = await booking("REQUESTED", "2026-10-24T22:00:00Z");
      const repeatedHour = await booking("CONFIRMED", "2026-10-25T01:30:00Z");
      const lastMinute = await booking("CONFIRMED", "2026-10-25T22:59:00Z");
      const after = await booking("CONFIRMED", "2026-10-25T23:00:00Z");

      const day = await list(sessions.admin, { from: "2026-10-25", to: "2026-10-25" });
      expect(day.items.map((item) => item.reference)).toEqual([
        firstMinute.reference,
        repeatedHour.reference,
        lastMinute.reference,
      ]);

      const fromOnly = await list(sessions.admin, { from: "2026-10-26" });
      expect(fromOnly.items.map((item) => item.reference)).toEqual([after.reference]);

      const toOnly = await list(sessions.admin, { to: "2026-10-24" });
      expect(toOnly.items.map((item) => item.reference)).toEqual([before.reference]);
    });

    it("filters by Paris pickup days around the 23-hour day of late March", async () => {
      // 2027-03-28 in Paris runs from 2027-03-27T23:00Z to 2027-03-28T22:00Z.
      const inside = await booking("REQUESTED", "2027-03-28T21:59:00Z");
      await booking("REQUESTED", "2027-03-28T22:00:00Z");
      await booking("REQUESTED", "2027-03-27T22:59:00Z");

      const day = await list(sessions.admin, { from: "2027-03-28", to: "2027-03-28" });
      expect(day.items.map((item) => item.reference)).toEqual([inside.reference]);
    });
  });

  describe("detail", () => {
    it("returns the booking with separated notes and its audit trail in chronological order", async () => {
      const { id, reference } = await booking("ACCEPTED", "2026-11-02T09:00:00Z", {
        customerNotes: "Siège enfant",
        internalNotes: "Client habituel",
        transportKind: "TRAIN",
        transportNumber: "TGV 6201",
      });
      await db().auditLog.createMany({
        data: [
          {
            actorType: "ADMIN",
            actorId: adminUserId,
            entityType: "Booking",
            entityId: id,
            action: "booking.transition",
            before: { status: "REQUESTED" },
            after: { status: "ACCEPTED" },
            createdAt: new Date("2026-10-02T10:00:00Z"),
          },
          {
            actorType: "CUSTOMER",
            actorId: customerId,
            entityType: "Booking",
            entityId: id,
            action: "booking.create",
            after: { status: "REQUESTED" },
            createdAt: new Date("2026-10-01T10:00:00Z"),
          },
          // Another entity with the same id: not part of this booking's trail.
          {
            actorType: "SYSTEM",
            entityType: "Payment",
            entityId: id,
            action: "payment.update",
            createdAt: new Date("2026-10-03T10:00:00Z"),
          },
        ],
      });

      const detail = await getBackOfficeBooking(sessions.dispatcher, reference.toLowerCase());
      expect(detail).toMatchObject({
        reference,
        status: "ACCEPTED",
        customerNotes: "Siège enfant",
        internalNotes: "Client habituel",
        transportKind: "TRAIN",
        transportNumber: "TGV 6201",
        totalTtcCents: 12_345,
        totalHtCents: null,
        vatCents: null,
        pricingRuleVersion: TEST_RULE.version,
        // No contact copy on this row (created as before VTC-037): the customer profile is used.
        contact: { name: "Client Test", phone: "+33100000000", locale: "fr", source: "customer" },
        customerEmail: "client@avelys.test",
      });
      expect(detail).not.toHaveProperty("pricingSnapshot");
      expect(detail).not.toHaveProperty("id");
      expect(detail?.audit).toEqual([
        expect.objectContaining({
          actorType: "CUSTOMER",
          actorName: null,
          action: "booking.create",
          fromStatus: null,
          toStatus: "REQUESTED",
        }),
        expect.objectContaining({
          actorType: "ADMIN",
          actorName: "Test ADMIN",
          action: "booking.transition",
          fromStatus: "REQUESTED",
          toStatus: "ACCEPTED",
        }),
      ]);
    });

    it("shows the booking's own contact copy rather than the customer profile (VTC-037)", async () => {
      const { reference } = await booking("REQUESTED", "2026-11-02T09:00:00Z", {
        contactName: "Autre Nom",
        contactPhone: "+33199999999",
        contactLocale: "en",
      });

      const detail = await getBackOfficeBooking(sessions.admin, reference);
      expect(detail?.contact).toEqual({
        name: "Autre Nom",
        phone: "+33199999999",
        locale: "en",
        source: "booking",
      });
      expect(detail?.customerEmail).toBe("client@avelys.test");
      expect(detail).not.toHaveProperty("customer");
      expect(detail).not.toHaveProperty("contactPhone");
    });

    it("returns null for an unknown or invalid reference", async () => {
      await expect(getBackOfficeBooking(sessions.admin, "VTC-00000000")).resolves.toBeNull();
      await expect(getBackOfficeBooking(sessions.admin, "not a reference")).resolves.toBeNull();
      await expect(getBackOfficeBooking(sessions.admin, "x".repeat(500))).resolves.toBeNull();
    });
  });
});
