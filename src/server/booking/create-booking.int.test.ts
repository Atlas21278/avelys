import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import type { PricingRuleConfig } from "@/domain/pricing/rule";
import { parsePricingSnapshot } from "@/domain/pricing/snapshot";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { RoutingError, type RoutingProvider } from "@/integrations/maps/routing";
import { runWithRequestContext } from "@/lib/request-context";
import { db } from "@/server/db";
import {
  createPricingRuleVersion,
  getActivePricingRule,
  type PricingRuleTariffInput,
} from "@/server/pricing/rules";
import { computeQuote } from "@/server/quotes/quote";

import {
  BookingCreationError,
  createBooking,
  MAX_REFERENCE_ATTEMPTS,
  type CreateBookingDeps,
  type CreateBookingRequest,
} from "./create-booking";
import { generateReference } from "./reference";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Routing and the payment guard are mocked: tests never call Google or Stripe.

// Tariff of the test fixture (PROVISIONAL — DEC-03), without the identity held by the columns.
const TARIFF: PricingRuleTariffInput = {
  currency: PROVISIONAL_RULE.currency,
  amountBasis: PROVISIONAL_RULE.amountBasis,
  rounding: PROVISIONAL_RULE.rounding,
  pickupCents: PROVISIONAL_RULE.pickupCents,
  perKmCents: PROVISIONAL_RULE.perKmCents,
  minimumCents: PROVISIONAL_RULE.minimumCents,
};

const NOW = new Date("2026-09-28T08:00:00.000Z");
const ROUTE = route({
  distanceMeters: 31_250,
  durationSeconds: 2_400,
  computedAt: NOW.toISOString(),
});

let rule: PricingRuleConfig;
let computeRoute: ReturnType<typeof vi.fn<RoutingProvider["computeRoute"]>>;
let hasConfirmedPaymentMethod: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

function expectedTotalCents(): number {
  return computeBaseFare(rule, ROUTE).total.amountCents;
}

// 2026-10-25 03:00 in Paris, just after the autumn change (UTC+1) = 02:00Z.
function request(overrides: Partial<CreateBookingRequest> = {}): CreateBookingRequest {
  return {
    origin: { label: "Test origin", lat: 48.8443, lng: 2.3743 },
    destination: { label: "Test destination", lat: 49.0097, lng: 2.5479, placeId: "test-place" },
    pickupLocalDateTime: "2026-10-25T03:00",
    passengers: 2,
    luggage: 1,
    customer: { name: "Guest Test", email: "Guest@Avelys.test", phone: "+33100000000" },
    customerNotes: "Test note",
    transport: { kind: "TRAIN", number: "TGV 6201", scheduledAt: "2026-10-25T02:50:00+01:00" },
    termsAccepted: true,
    displayedTotal: { amountCents: expectedTotalCents(), currency: "EUR" },
    paymentSetupId: "test-setup",
    ...overrides,
  };
}

function deps(overrides: Partial<CreateBookingDeps> = {}): CreateBookingDeps {
  return {
    quote: (quoteRequest) =>
      computeQuote(quoteRequest, {
        routing: { computeRoute },
        activePricingRule: getActivePricingRule,
        now: () => NOW,
        // Arbitrary test lead time, not the business value (BR-31).
        minLeadTimeMinutes: 60,
      }),
    paymentMethodGuard: { hasConfirmedPaymentMethod },
    generateReference,
    db: db(),
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<BookingCreationError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BookingCreationError);
  return error as BookingCreationError;
}

async function expectNothingWritten(): Promise<void> {
  await expect(db().customer.count()).resolves.toBe(0);
  await expect(db().booking.count()).resolves.toBe(0);
  await expect(db().auditLog.count({ where: { entityType: "Booking" } })).resolves.toBe(0);
}

describe("booking creation service (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.auditLog.deleteMany();
    await client.booking.deleteMany();
    await client.customer.deleteMany();
    await client.pricingRule.deleteMany();
    rule = await createPricingRuleVersion(
      { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), tariff: TARIFF },
      { type: "SYSTEM" },
    );
    computeRoute = vi.fn<RoutingProvider["computeRoute"]>().mockResolvedValue(ROUTE);
    hasConfirmedPaymentMethod = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  });

  afterAll(async () => {
    // Leave no booking behind: stale rows would break later foreign key validations.
    await db().booking.deleteMany();
    await db().customer.deleteMany();
    await db().$disconnect();
  });

  it("creates a REQUESTED booking, its guest customer and its audit row", async () => {
    const created = await runWithRequestContext({ correlationId: "test-correlation-1" }, () =>
      createBooking(request(), deps()),
    );

    expect(created.status).toBe("REQUESTED");
    expect(created.total).toEqual({ amountCents: expectedTotalCents(), currency: "EUR" });

    const booking = await db().booking.findUniqueOrThrow({ where: { id: created.bookingId } });
    expect(booking).toMatchObject({
      reference: created.reference,
      customerId: created.customerId,
      status: "REQUESTED",
      version: 1,
      pickupLabel: "Test origin",
      pickupPlaceId: null,
      dropoffPlaceId: "test-place",
      pickupTimeZone: "Europe/Paris",
      passengerCount: 2,
      luggageCount: 1,
      quotedDistanceMeters: ROUTE.distanceMeters,
      quotedDurationSeconds: ROUTE.durationSeconds,
      totalTtcCents: expectedTotalCents(),
      totalHtCents: null,
      vatCents: null,
      currency: "EUR",
      pricingRuleId: rule.id,
      pricingRuleVersion: rule.version,
      transportKind: "TRAIN",
      transportNumber: "TGV 6201",
      customerNotes: "Test note",
      internalNotes: null,
    });
    expect(booking.pickupAt.toISOString()).toBe("2026-10-25T02:00:00.000Z");
    expect(booking.pickupLocalDateTime.toISOString()).toBe("2026-10-25T03:00:00.000Z");
    expect(booking.transportScheduledAt?.toISOString()).toBe("2026-10-25T01:50:00.000Z");

    // The stored snapshot is the server's own and validates against PricingSnapshot (BR-13).
    const snapshot = parsePricingSnapshot(booking.pricingSnapshot);
    expect(snapshot.rule).toEqual(rule);
    expect(snapshot.totals.ttcCents).toBe(booking.totalTtcCents);

    const customer = await db().customer.findUniqueOrThrow({ where: { id: created.customerId } });
    expect(customer).toMatchObject({
      name: "Guest Test",
      email: "guest@avelys.test",
      phone: "+33100000000",
      preferredLocale: "fr",
      userId: null,
    });

    const trail = await db().auditLog.findMany({
      where: { entityType: "Booking", entityId: booking.id },
    });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      actorType: "CUSTOMER",
      actorId: customer.id,
      action: "booking.create",
      before: null,
      after: {
        bookingRef: booking.reference,
        status: "REQUESTED",
        version: 1,
        totalTtcCents: booking.totalTtcCents,
        currency: "EUR",
        pricingRuleVersion: rule.version,
      },
      correlationId: "test-correlation-1",
    });
    // No personal data in the trail (BR-60).
    const serialised = JSON.stringify(trail[0]);
    for (const personal of ["Guest", "guest@", "+331", "Test origin", "Test destination"]) {
      expect(serialised).not.toContain(personal);
    }
  });

  it("reuses an existing guest customer matched by normalised email, without merging", async () => {
    const first = await createBooking(request(), deps());
    const second = await createBooking(
      request({
        customer: { name: "Other Name", email: " GUEST@avelys.TEST", phone: "+33199999999" },
      }),
      deps(),
    );

    expect(second.customerId).toBe(first.customerId);
    expect(second.reference).not.toBe(first.reference);
    await expect(db().customer.count()).resolves.toBe(1);
    // The existing profile is kept as is (no profile merge).
    const customer = await db().customer.findUniqueOrThrow({ where: { id: first.customerId } });
    expect(customer.name).toBe("Guest Test");
    expect(customer.phone).toBe("+33100000000");
  });

  it("never attaches a guest request to a customer profile linked to an account", async () => {
    const user = await db().user.create({
      data: { id: "test-user-vtc028", name: "Account Holder", email: "holder@avelys.test" },
    });
    try {
      const linked = await db().customer.create({
        data: { name: "Account Holder", email: "guest@avelys.test", userId: user.id },
      });
      const created = await createBooking(request(), deps());
      expect(created.customerId).not.toBe(linked.id);
    } finally {
      await db().booking.deleteMany();
      await db().customer.deleteMany();
      await db().user.delete({ where: { id: user.id } });
    }
  });

  it("keeps the recomputed price and the booking snapshot when the rule changes afterwards", async () => {
    const created = await createBooking(request(), deps());
    await createPricingRuleVersion(
      {
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        tariff: { ...TARIFF, perKmCents: TARIFF.perKmCents + 100 },
      },
      { type: "SYSTEM" },
    );

    const booking = await db().booking.findUniqueOrThrow({ where: { id: created.bookingId } });
    expect(booking.totalTtcCents).toBe(created.total.amountCents);
    expect(booking.pricingRuleVersion).toBe(rule.version);
  });

  it("refuses a stale displayed price with PRICE_CHANGED and writes nothing", async () => {
    const error = await refusal(
      createBooking(
        request({ displayedTotal: { amountCents: expectedTotalCents() + 100, currency: "EUR" } }),
        deps(),
      ),
    );
    expect(error.code).toBe("PRICE_CHANGED");
    expect(error.details.total).toEqual({ amountCents: expectedTotalCents(), currency: "EUR" });
    await expectNothingWritten();
  });

  it("refuses without a confirmed payment method and writes nothing", async () => {
    hasConfirmedPaymentMethod.mockResolvedValue(false);
    const error = await refusal(createBooking(request(), deps()));
    expect(error.code).toBe("PAYMENT_METHOD_REQUIRED");
    await expectNothingWritten();
  });

  it("refuses a pickup inside the minimum lead time and writes nothing", async () => {
    const error = await refusal(
      createBooking(request({ pickupLocalDateTime: "2026-09-28T10:30" }), deps()),
    );
    expect(error.code).toBe("BOOKING_LEAD_TIME_TOO_SHORT");
    expect(computeRoute).not.toHaveBeenCalled();
    await expectNothingWritten();
  });

  it("refuses when no road route exists and writes nothing (no invented price)", async () => {
    computeRoute.mockRejectedValue(new RoutingError("ROUTE_UNAVAILABLE", "no_route", "No route"));
    const error = await refusal(createBooking(request(), deps()));
    expect(error.code).toBe("ROUTE_UNAVAILABLE");
    await expectNothingWritten();
  });

  it("retries with a new reference after a collision", async () => {
    const first = await createBooking(request(), deps());
    const references = [first.reference, generateReference()];
    const next = vi.fn(() => references.shift() ?? generateReference());

    const second = await createBooking(request(), deps({ generateReference: next }));
    expect(next).toHaveBeenCalledTimes(2);
    expect(second.reference).not.toBe(first.reference);
    await expect(db().booking.count()).resolves.toBe(2);
    await expect(db().auditLog.count({ where: { entityType: "Booking" } })).resolves.toBe(2);
  });

  it("gives up after a bounded number of collisions and rolls every write back", async () => {
    const first = await createBooking(request(), deps());
    const colliding = vi.fn(() => first.reference);

    const error = await refusal(
      createBooking(
        request({ customer: { name: "New Guest", email: "new-guest@avelys.test" } }),
        deps({ generateReference: colliding }),
      ),
    );
    expect(error.code).toBe("BOOKING_REFERENCE_UNAVAILABLE");
    expect(colliding).toHaveBeenCalledTimes(MAX_REFERENCE_ATTEMPTS);
    expect(error.cause).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // The new customer of each attempt was rolled back with its booking.
    await expect(db().customer.count()).resolves.toBe(1);
    await expect(db().booking.count()).resolves.toBe(1);
    await expect(db().auditLog.count({ where: { entityType: "Booking" } })).resolves.toBe(1);
  });

  it("rolls the customer and the booking back when the audit write fails", async () => {
    const failingAudit = db().$extends({
      query: {
        auditLog: {
          create: () => Promise.reject(new Error("audit write failure (test)")),
        },
      },
    }) as unknown as PrismaClient;

    await expect(createBooking(request(), deps({ db: failingAudit }))).rejects.toThrow(
      "audit write failure (test)",
    );
    await expectNothingWritten();
  });

  it("keeps the booking when the post-commit hook fails (BR-50)", async () => {
    const afterCommit = vi.fn(() => Promise.reject(new Error("email failure (test)")));
    const created = await createBooking(request(), deps({ afterCommit }));

    expect(afterCommit).toHaveBeenCalledWith(created);
    const booking = await db().booking.findUniqueOrThrow({ where: { id: created.bookingId } });
    expect(booking.status).toBe("REQUESTED");
  });

  it("refuses to delete a customer who has a booking (P2003)", async () => {
    const created = await createBooking(request(), deps());
    const error: unknown = await db()
      .customer.delete({ where: { id: created.customerId } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toMatchObject({ code: "P2003" });
    await expect(db().customer.count()).resolves.toBe(1);
  });
});
