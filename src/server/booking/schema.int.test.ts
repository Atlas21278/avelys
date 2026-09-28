import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { createPrismaClient, db } from "@/server/db";

import { generateReference } from "./reference";

// Runs against the real test database (vitest "integration" project), migrations applied.

// 2026-10-25 is the autumn DST change in Paris: 02:30 local happens twice. The UTC instant
// (01:30Z = 02:30 CET, second occurrence) plus the entered wall-clock time remove the ambiguity.
const PICKUP_AT = new Date("2026-10-25T01:30:00.000Z");
const PICKUP_LOCAL = new Date(Date.UTC(2026, 9, 25, 2, 30));

// Referenced by Booking (composite foreign key, VTC-025). Test row only: its config is not a tariff.
const TEST_RULE = { id: "test-rule", version: 1 } as const;

async function testPricingRule() {
  return db().pricingRule.create({
    data: {
      ...TEST_RULE,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      config: { note: "test rule, not a tariff" },
      schemaVersion: 1,
    },
  });
}

async function guestCustomer() {
  return db().customer.create({
    data: { name: "Guest Test", email: "guest@avelys.test", phone: "+33100000000" },
  });
}

function minimalBooking(customerId: string, reference = generateReference()) {
  return {
    reference,
    customerId,
    pickupLabel: "Gare de Lyon, Paris",
    pickupLat: 48.844_3,
    pickupLng: 2.374_3,
    dropoffLabel: "Aéroport Paris-Charles de Gaulle",
    dropoffLat: 49.009_7,
    dropoffLng: 2.547_9,
    pickupAt: PICKUP_AT,
    pickupLocalDateTime: PICKUP_LOCAL,
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
  } satisfies Prisma.BookingUncheckedCreateInput;
}

describe("booking schema (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.auditLog.deleteMany();
    await client.booking.deleteMany();
    await client.customer.deleteMany();
    await client.pricingRule.deleteMany();
    await testPricingRule();
  });

  afterAll(async () => {
    await db().$disconnect();
  });

  it("stores a guest customer without a user account", async () => {
    const customer = await guestCustomer();
    expect(customer.userId).toBeNull();
    expect(customer.preferredLocale).toBe("fr");
  });

  it("stores a minimal REQUESTED booking with defaults and no invented VAT", async () => {
    const customer = await guestCustomer();
    const booking = await db().booking.create({ data: minimalBooking(customer.id) });

    expect(booking.status).toBe("REQUESTED");
    expect(booking.version).toBe(1);
    expect(booking.pickupTimeZone).toBe("Europe/Paris");
    expect(booking.totalTtcCents).toBe(12_345);
    expect(booking.totalHtCents).toBeNull();
    expect(booking.vatCents).toBeNull();
    expect(booking.cancelledAt).toBeNull();
    expect(booking.completedAt).toBeNull();
    expect(booking.pricingSnapshot).toEqual({ schemaVersion: 1, note: "test snapshot" });
  });

  it("rejects a duplicate reference (P2002)", async () => {
    const customer = await guestCustomer();
    const reference = generateReference();
    await db().booking.create({ data: minimalBooking(customer.id, reference) });

    const error: unknown = await db()
      .booking.create({ data: minimalBooking(customer.id, reference) })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toMatchObject({ code: "P2002" });
    await expect(db().booking.count({ where: { reference } })).resolves.toBe(1);
  });

  it("returns the pickup instant in UTC even when the database defaults to another zone", async () => {
    const customer = await guestCustomer();
    const { id } = await db().booking.create({ data: minimalBooking(customer.id) });

    // A server or database default other than UTC must not shift instants (see db.ts).
    // Only new sessions pick up the default: open a dedicated client after changing it.
    await db().$executeRawUnsafe(
      `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET TimeZone TO %L', current_database(), 'Pacific/Auckland'); END $$`,
    );
    const client = createPrismaClient(process.env.DATABASE_URL ?? "");
    try {
      const [session] = await client.$queryRaw<Array<{ tz: string }>>`
        SELECT current_setting('TimeZone') AS tz`;
      expect(session?.tz).toBe("UTC");

      const stored = await client.booking.findUniqueOrThrow({ where: { id } });
      expect(stored.pickupAt.toISOString()).toBe("2026-10-25T01:30:00.000Z");
      // Wall-clock time as entered, without offset: its UTC fields are the local fields.
      expect(stored.pickupLocalDateTime.toISOString()).toBe("2026-10-25T02:30:00.000Z");
    } finally {
      await client.$disconnect();
      await db().$executeRawUnsafe(
        `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I RESET TimeZone', current_database()); END $$`,
      );
    }
  });

  it("keeps amounts as integer columns and the currency as CHAR(3)", async () => {
    const columns = await db().$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'Booking'
        AND column_name IN ('totalTtcCents', 'totalHtCents', 'vatCents', 'currency')
      ORDER BY column_name`;
    expect(columns).toEqual([
      { column_name: "currency", data_type: "character" },
      { column_name: "totalHtCents", data_type: "integer" },
      { column_name: "totalTtcCents", data_type: "integer" },
      { column_name: "vatCents", data_type: "integer" },
    ]);
  });

  it("refuses to delete a customer who still has bookings", async () => {
    const customer = await guestCustomer();
    await db().booking.create({ data: minimalBooking(customer.id) });

    await expect(db().customer.delete({ where: { id: customer.id } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it("rejects a booking whose pricing rule version does not exist (P2003)", async () => {
    const customer = await guestCustomer();
    const error: unknown = await db()
      .booking.create({
        data: { ...minimalBooking(customer.id), pricingRuleVersion: TEST_RULE.version + 1 },
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toMatchObject({ code: "P2003" });
  });

  it("refuses to delete a pricing rule referenced by a booking", async () => {
    const customer = await guestCustomer();
    await db().booking.create({ data: minimalBooking(customer.id) });

    await expect(db().pricingRule.delete({ where: { id: TEST_RULE.id } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it("writes an audit log row for a transition", async () => {
    const customer = await guestCustomer();
    const booking = await db().booking.create({ data: minimalBooking(customer.id) });

    const row = await db().auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: "staff-user-id",
        entityType: "Booking",
        entityId: booking.id,
        action: "booking.transition",
        before: { status: "REQUESTED", version: 1 },
        after: { status: "ACCEPTED", version: 2 },
        correlationId: "test-correlation-id",
      },
    });

    const trail = await db().auditLog.findMany({
      where: { entityType: "Booking", entityId: booking.id },
    });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      id: row.id,
      actorType: "ADMIN",
      before: { status: "REQUESTED", version: 1 },
      after: { status: "ACCEPTED", version: 2 },
    });
    expect(trail[0]?.createdAt).toBeInstanceOf(Date);
  });
});
