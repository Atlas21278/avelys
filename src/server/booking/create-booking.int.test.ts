import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import type { PricingRuleConfig } from "@/domain/pricing/rule";
import { parsePricingSnapshot } from "@/domain/pricing/snapshot";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { GoogleRoutesProvider } from "@/integrations/maps/google-routes";
import { RoutingError, type RoutingProvider } from "@/integrations/maps/routing";
import type { PaymentSetupGateway } from "@/integrations/stripe";
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
import {
  createStripePaymentMethodGuard,
  type ConfirmedPaymentMethod,
  type PaymentMethodGuard,
} from "./payment-method-guard";
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

// Where the (mocked) provider resolved the waypoints to: the priced coordinates (VTC-035).
const PRICED_ORIGIN = { lat: 48.8442, lng: 2.3744 };
const PRICED_DESTINATION = { lat: 49.0094, lng: 2.5483 };
const RESOLVED = { route: ROUTE, origin: PRICED_ORIGIN, destination: PRICED_DESTINATION };

let rule: PricingRuleConfig;
let computeRoute: ReturnType<typeof vi.fn<RoutingProvider["computeRoute"]>>;
let confirmedPaymentMethod: ReturnType<typeof vi.fn<PaymentMethodGuard["confirmedPaymentMethod"]>>;
let setupCounter = 0;

/** A distinct (fake) confirmed SetupIntent per call: one booking per SetupIntent. */
function nextPaymentMethod(): ConfirmedPaymentMethod {
  setupCounter += 1;
  return {
    setupIntentId: `seti_Test${setupCounter}`,
    customerId: `cus_Test${setupCounter}`,
    paymentMethodId: `pm_Test${setupCounter}`,
  };
}

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
    paymentSetupId: "seti_TestRequest",
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
    paymentMethodGuard: { confirmedPaymentMethod },
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
  await expect(db().payment.count()).resolves.toBe(0);
  await expect(
    db().auditLog.count({ where: { entityType: { in: ["Booking", "Payment"] } } }),
  ).resolves.toBe(0);
}

describe("booking creation service (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.auditLog.deleteMany();
    await client.payment.deleteMany();
    await client.notification.deleteMany();
    await client.booking.deleteMany();
    await client.customer.deleteMany();
    await client.pricingRule.deleteMany();
    rule = await createPricingRuleVersion(
      { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), tariff: TARIFF },
      { type: "SYSTEM" },
    );
    computeRoute = vi.fn<RoutingProvider["computeRoute"]>().mockResolvedValue(RESOLVED);
    confirmedPaymentMethod = vi
      .fn<PaymentMethodGuard["confirmedPaymentMethod"]>()
      .mockImplementation(() => Promise.resolve(nextPaymentMethod()));
  });

  afterAll(async () => {
    // Leave no booking behind: stale rows would break later foreign key validations.
    await db().payment.deleteMany();
    await db().notification.deleteMany();
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
      contactName: "Guest Test",
      contactPhone: "+33100000000",
      contactLocale: "fr",
      status: "REQUESTED",
      version: 1,
      pickupLabel: "Test origin",
      pickupLat: PRICED_ORIGIN.lat,
      pickupLng: PRICED_ORIGIN.lng,
      pickupPlaceId: null,
      dropoffLat: PRICED_DESTINATION.lat,
      dropoffLng: PRICED_DESTINATION.lng,
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
    // The snapshot keeps the priced end points, the same as the booking columns (VTC-039).
    expect(snapshot.resolvedPoints).toEqual({
      origin: { lat: booking.pickupLat, lng: booking.pickupLng },
      destination: { lat: booking.dropoffLat, lng: booking.dropoffLng },
    });

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

  it("creates the PENDING Payment, the current payment reference and its audit row (VTC-031)", async () => {
    const method = nextPaymentMethod();
    confirmedPaymentMethod.mockResolvedValue(method);
    const created = await runWithRequestContext({ correlationId: "test-correlation-2" }, () =>
      createBooking(request(), deps()),
    );

    const booking = await db().booking.findUniqueOrThrow({
      where: { id: created.bookingId },
      include: { currentPayment: true, payments: { select: { id: true } } },
    });
    expect(booking.currentPaymentId).toBe(created.paymentId);
    expect(booking.payments).toEqual([{ id: created.paymentId }]);
    // The payment reference is part of the creation: the booking keeps its initial version.
    expect(booking.version).toBe(1);
    expect(booking.currentPayment).toMatchObject({
      bookingId: booking.id,
      status: "PENDING",
      amountCents: booking.totalTtcCents,
      currency: booking.currency,
      stripeCustomerId: method.customerId,
      stripeSetupIntentId: method.setupIntentId,
      stripePaymentMethodId: method.paymentMethodId,
      // Nothing charged: no PaymentIntent at the request stage.
      stripePaymentIntentId: null,
      attempt: 0,
      version: 1,
    });

    const trail = await db().auditLog.findMany({
      where: { entityType: "Payment", entityId: created.paymentId },
    });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      actorType: "CUSTOMER",
      actorId: created.customerId,
      action: "payment.create",
      before: null,
      after: {
        bookingRef: booking.reference,
        status: "PENDING",
        version: 1,
        amountCents: booking.totalTtcCents,
        currency: "EUR",
        attempt: 0,
      },
      correlationId: "test-correlation-2",
    });
    // Neither a Stripe id nor personal data in the trail (BR-40, BR-60).
    expect(JSON.stringify(trail[0])).not.toMatch(/seti_|cus_|pm_|guest/i);
  });

  it("stores the priced coordinates of a forged request, never the submitted ones (VTC-035)", async () => {
    // Priced from place ids A→B while claiming coordinates C→D (far away, e.g. Lyon/Marseille).
    const created = await createBooking(
      request({
        origin: { label: "Test origin", lat: 45.764, lng: 4.8357, placeId: "test-place-a" },
        destination: {
          label: "Test destination",
          lat: 43.2965,
          lng: 5.3698,
          placeId: "test-place-b",
        },
      }),
      deps(),
    );

    expect(computeRoute).toHaveBeenCalledExactlyOnceWith({
      origin: { placeId: "test-place-a" },
      destination: { placeId: "test-place-b" },
    });
    const stored = await db().booking.findUniqueOrThrow({
      where: { id: created.bookingId },
      select: { pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true },
    });
    expect(stored).toEqual({
      pickupLat: PRICED_ORIGIN.lat,
      pickupLng: PRICED_ORIGIN.lng,
      dropoffLat: PRICED_DESTINATION.lat,
      dropoffLng: PRICED_DESTINATION.lng,
    });
  });

  it("writes nothing when the provider cannot resolve the priced end points", async () => {
    computeRoute.mockRejectedValue(
      new RoutingError("ROUTING_PROVIDER_ERROR", "invalid_response", "No resolved end points"),
    );
    const error = await refusal(createBooking(request(), deps()));
    expect(error.code).toBe("ROUTE_UNAVAILABLE");
    await expectNothingWritten();
  });

  describe("with the Google Routes adapter (mocked fetch): implausible resolved points (VTC-039)", () => {
    const googleLocation = ({ lat, lng }: { lat: number; lng: number }) => ({
      latLng: { latitude: lat, longitude: lng },
    });
    const adapterFor = (destination: { lat: number; lng: number }) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: ROUTE.distanceMeters,
                duration: `${ROUTE.durationSeconds}s`,
                legs: [
                  {
                    startLocation: googleLocation(PRICED_ORIGIN),
                    endLocation: googleLocation(destination),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      const provider = new GoogleRoutesProvider({
        // Test-only placeholder: fetch is mocked, Google is never called.
        apiKey: () => "test-key-never-real-0000",
        fetch: fetchMock,
        now: () => NOW,
        logger: { info: vi.fn(), warn: vi.fn() },
      });
      return { provider, fetchMock };
    };

    it.each([
      ["resolved to (0, 0)", { lat: 0, lng: 0 }],
      ["resolved outside the service area", { lat: 40.7128, lng: -74.006 }],
    ])("writes nothing when a point is %s", async (_label, destination) => {
      const { provider, fetchMock } = adapterFor(destination);
      computeRoute.mockImplementation((routeRequest) => provider.computeRoute(routeRequest));

      const error = await refusal(createBooking(request(), deps()));
      expect(error.code).toBe("ROUTE_UNAVAILABLE");
      expect(fetchMock).toHaveBeenCalledOnce();
      await expectNothingWritten();
    });

    it("creates the booking when both points are inside the service area", async () => {
      const { provider } = adapterFor(PRICED_DESTINATION);
      computeRoute.mockImplementation((routeRequest) => provider.computeRoute(routeRequest));

      const created = await createBooking(request(), deps());
      const stored = await db().booking.findUniqueOrThrow({ where: { id: created.bookingId } });
      expect(parsePricingSnapshot(stored.pricingSnapshot).resolvedPoints).toEqual({
        origin: PRICED_ORIGIN,
        destination: PRICED_DESTINATION,
      });
    });
  });

  it("reuses an existing guest customer matched by normalised email, without merging", async () => {
    const first = await createBooking(request(), deps());
    const profileBefore = await db().customer.findUniqueOrThrow({
      where: { id: first.customerId },
    });
    const second = await createBooking(
      request({
        customer: {
          name: "Other Name",
          email: " GUEST@avelys.TEST",
          phone: "+33199999999",
          locale: "en",
        },
      }),
      deps(),
    );

    expect(second.customerId).toBe(first.customerId);
    expect(second.reference).not.toBe(first.reference);
    await expect(db().customer.count()).resolves.toBe(1);
    // The existing profile is kept as is: no merge, never rewritten by a guest (DEC-25).
    const customer = await db().customer.findUniqueOrThrow({ where: { id: first.customerId } });
    expect(customer).toEqual(profileBefore);

    // Each booking carries the contact submitted with it (VTC-037).
    const contact = { contactName: true, contactPhone: true, contactLocale: true } as const;
    await expect(
      db().booking.findUniqueOrThrow({ where: { id: first.bookingId }, select: contact }),
    ).resolves.toEqual({
      contactName: "Guest Test",
      contactPhone: "+33100000000",
      contactLocale: "fr",
    });
    await expect(
      db().booking.findUniqueOrThrow({ where: { id: second.bookingId }, select: contact }),
    ).resolves.toEqual({
      contactName: "Other Name",
      contactPhone: "+33199999999",
      contactLocale: "en",
    });

    // The contact copy never reaches the audit trail (BR-60).
    const trail = await db().auditLog.findFirstOrThrow({
      where: { entityType: "Booking", entityId: second.bookingId },
    });
    const serialised = JSON.stringify(trail);
    for (const personal of ["Other Name", "+33199999999", "guest@"]) {
      expect(serialised).not.toContain(personal);
    }
  });

  it("serialises two concurrent requests for one email onto one guest customer (VTC-036)", async () => {
    // Deterministic overlap, no sleep: a third transaction holds the per-email advisory lock
    // (same key as `persist`), both requests are started and the test waits until PostgreSQL
    // reports both of them blocked on that lock; only then is the lock released. Without the
    // lock (or with a different key) they never wait and the test fails instead of passing.
    const email = "guest@avelys.test";
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => (releaseHolder = resolve));
    let holderLocked!: () => void;
    const holderHasLock = new Promise<void>((resolve) => (holderLocked = resolve));

    const holder = db().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer:${email}`}, 0))::text AS locked`;
        holderLocked();
        await holderReleased;
      },
      { timeout: 14_000 },
    );
    await holderHasLock;

    let settled = false;
    const both = Promise.allSettled([
      createBooking(request(), deps()),
      createBooking(
        request({ customer: { name: "Second Guest", email: " GUEST@Avelys.TEST", locale: "en" } }),
        deps(),
      ),
    ]).finally(() => (settled = true));

    try {
      // Bounded poll (the interval is a polling pace, not a timing assumption).
      const deadline = Date.now() + 10_000;
      for (;;) {
        if (settled) throw new Error("the requests completed without waiting for the email lock");
        const [row] = await db().$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        if (row?.waiting === 2) break;
        if (Date.now() > deadline) {
          throw new Error(
            `both requests were not blocked on the email lock within 10 s (waiting: ${row?.waiting ?? 0})`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      releaseHolder();
      // An expired holder must not mask the original error.
      await holder.catch(() => undefined);
      // Let both requests finish, so none writes rows during the next test's beforeEach.
      await both;
    }

    const results = await both;
    const created = results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    const [first, second] = created;

    expect(first?.customerId).toBeDefined();
    expect(second?.customerId).toBe(first?.customerId);
    expect(second?.reference).not.toBe(first?.reference);
    await expect(db().customer.count()).resolves.toBe(1);
    await expect(db().customer.count({ where: { email, userId: null } })).resolves.toBe(1);
    await expect(db().booking.count()).resolves.toBe(2);
    const trail = await db().auditLog.findMany({
      where: { entityType: "Booking", action: "booking.create" },
    });
    expect(trail).toHaveLength(2);
    expect(new Set(trail.map((row) => row.entityId))).toEqual(
      new Set(created.map((booking) => booking.bookingId)),
    );
  });

  it("stores no phone on the booking when none is submitted, whatever the profile holds", async () => {
    const first = await createBooking(request(), deps());
    const second = await createBooking(
      request({ customer: { name: "Guest Test", email: "guest@avelys.test" } }),
      deps(),
    );

    expect(second.customerId).toBe(first.customerId);
    const booking = await db().booking.findUniqueOrThrow({ where: { id: second.bookingId } });
    expect(booking).toMatchObject({ contactPhone: null, contactLocale: "fr" });
    const customer = await db().customer.findUniqueOrThrow({ where: { id: first.customerId } });
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
      await db().payment.deleteMany();
      await db().notification.deleteMany();
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
    confirmedPaymentMethod.mockResolvedValue(null);
    const error = await refusal(createBooking(request(), deps()));
    expect(error.code).toBe("PAYMENT_METHOD_REQUIRED");
    expect(confirmedPaymentMethod).toHaveBeenCalledWith({
      paymentSetupId: "seti_TestRequest",
      email: "guest@avelys.test",
    });
    await expectNothingWritten();
  });

  it("refuses a SetupIntent already used by a booking (unique constraint) and writes nothing more", async () => {
    const reused = nextPaymentMethod();
    confirmedPaymentMethod.mockResolvedValue(reused);
    const first = await createBooking(request(), deps());

    const error = await refusal(
      createBooking(
        request({ customer: { name: "Other Guest", email: "other-guest@avelys.test" } }),
        deps(),
      ),
    );
    expect(error.code).toBe("PAYMENT_METHOD_REQUIRED");
    expect(error.reason).toBe("payment_setup_already_used");
    expect(error.cause).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // The second request's customer, booking, payment and audit rows were all rolled back.
    await expect(db().customer.count()).resolves.toBe(1);
    await expect(db().booking.count()).resolves.toBe(1);
    await expect(db().payment.findMany({ select: { bookingId: true } })).resolves.toEqual([
      { bookingId: first.bookingId },
    ]);
    await expect(
      db().auditLog.count({ where: { entityType: { in: ["Booking", "Payment"] } } }),
    ).resolves.toBe(2);
  });

  it("with the Stripe guard (mocked gateway): creates once, then refuses the used SetupIntent", async () => {
    const retrieveSetupIntent = vi.fn<PaymentSetupGateway["retrieveSetupIntent"]>(() =>
      Promise.resolve({
        id: "seti_GuardTest1",
        status: "succeeded",
        usage: "off_session",
        livemode: false,
        fromBookingRequestFlow: true,
        customerId: "cus_GuardTest1",
        customerEmail: "guest@avelys.test",
        paymentMethodId: "pm_GuardTest1",
      }),
    );
    const paymentMethodGuard = createStripePaymentMethodGuard({
      gateway: () => ({
        createSetupIntent: () => Promise.reject(new Error("not used")),
        retrieveSetupIntent,
      }),
      db: db(),
    });

    const created = await createBooking(
      request({ paymentSetupId: "seti_GuardTest1" }),
      deps({ paymentMethodGuard }),
    );
    await expect(
      db().payment.findUniqueOrThrow({ where: { id: created.paymentId } }),
    ).resolves.toMatchObject({ stripeSetupIntentId: "seti_GuardTest1", status: "PENDING" });

    const error = await refusal(
      createBooking(
        request({
          paymentSetupId: "seti_GuardTest1",
          customer: { name: "Other Guest", email: "other-guest@avelys.test" },
        }),
        deps({ paymentMethodGuard }),
      ),
    );
    expect(error.code).toBe("PAYMENT_METHOD_REQUIRED");
    // Refused from the database before Stripe is asked again.
    expect(retrieveSetupIntent).toHaveBeenCalledTimes(1);
    await expect(db().booking.count()).resolves.toBe(1);
  });

  it("rejects a second booking on the same SetupIntent at the database level", async () => {
    const created = await createBooking(request(), deps());
    const payment = await db().payment.findUniqueOrThrow({ where: { id: created.paymentId } });
    const error: unknown = await db()
      .payment.create({
        data: {
          bookingId: created.bookingId,
          amountCents: 100,
          currency: "EUR",
          stripeCustomerId: "cus_Other1",
          stripeSetupIntentId: payment.stripeSetupIntentId,
          stripePaymentMethodId: "pm_Other1",
        },
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "P2002" });
  });

  it("allows one current Payment per booking and no Payment without a booking", async () => {
    const first = await createBooking(request(), deps());
    const second = await createBooking(
      request({ customer: { name: "Other Guest", email: "other-guest@avelys.test" } }),
      deps(),
    );
    const sharedCurrent: unknown = await db()
      .booking.update({
        where: { id: second.bookingId },
        data: { currentPaymentId: first.paymentId },
      })
      .catch((caught: unknown) => caught);
    expect(sharedCurrent).toMatchObject({ code: "P2002" });

    const orphan: unknown = await db()
      .payment.create({
        data: {
          bookingId: "missing-booking",
          amountCents: 100,
          currency: "EUR",
          stripeCustomerId: "cus_Other2",
          stripeSetupIntentId: "seti_Other2",
          stripePaymentMethodId: "pm_Other2",
        },
      })
      .catch((caught: unknown) => caught);
    expect(orphan).toMatchObject({ code: "P2003" });
  });

  it("rolls every row back when the payment write fails", async () => {
    const failingPayment = db().$extends({
      query: {
        payment: {
          create: () => Promise.reject(new Error("payment write failure (test)")),
        },
      },
    }) as unknown as PrismaClient;

    await expect(createBooking(request(), deps({ db: failingPayment }))).rejects.toThrow(
      "payment write failure (test)",
    );
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
