import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import { db } from "@/server/db";
import { createPricingRuleVersion, type PricingRuleTariffInput } from "@/server/pricing/rules";
import type { QuoteDeps } from "@/server/quotes/quote";

// Runs the real route, idempotent service, creation service, guard and PostgreSQL (vitest
// "integration" project, PUBLIC_BOOKING_ENABLED=true). Only Google Routes and Stripe are mocked:
// no network, no key. Ids are fake test values. The Stripe adapter is replaced by module path
// only: src/app never imports an integration.

const NOW = new Date("2026-09-28T08:00:00.000Z");
const ROUTE = route({
  distanceMeters: 31_250,
  durationSeconds: 2_400,
  computedAt: NOW.toISOString(),
});
const RESOLVED = {
  route: ROUTE,
  origin: { lat: 48.8442, lng: 2.3744 },
  destination: { lat: 49.0094, lng: 2.5483 },
};

/** Shape of the adapter's SetupIntent summary (`SetupIntentSummary`). */
type SetupIntentFixture = {
  id: string;
  status: string;
  usage: string;
  livemode: boolean;
  fromBookingRequestFlow: boolean;
  customerId: string | null;
  customerEmail: string | null;
  paymentMethodId: string | null;
};

const mocks = vi.hoisted(() => ({
  computeRoute: vi.fn(),
  retrieveSetupIntent: vi.fn(),
  gateway: vi.fn(),
  configError: undefined as ((reason: string) => Error) | undefined,
}));

vi.mock("@/integrations/stripe", async (importActual) => {
  const actual: Record<string, unknown> = await importActual();
  const StripeConfigError = actual.StripeConfigError as new (reason: string) => Error;
  mocks.configError = (reason) => new StripeConfigError(reason);
  return { ...actual, stripePaymentSetup: () => mocks.gateway() as unknown };
});

vi.mock("@/server/quotes", async (importActual) => {
  const actual: Record<string, unknown> = await importActual();
  const { computeQuote } = await import("@/server/quotes/quote");
  const { getActivePricingRule } = await import("@/server/pricing/rules");
  return {
    ...actual,
    quote: (input: unknown) =>
      computeQuote(input, {
        routing: { computeRoute: mocks.computeRoute as QuoteDeps["routing"]["computeRoute"] },
        activePricingRule: getActivePricingRule,
        now: () => NOW,
        // Arbitrary test lead time, not the business value (BR-31).
        minLeadTimeMinutes: 60,
      }),
  };
});

const { POST } = await import("./route");

const TARIFF: PricingRuleTariffInput = {
  currency: PROVISIONAL_RULE.currency,
  amountBasis: PROVISIONAL_RULE.amountBasis,
  rounding: PROVISIONAL_RULE.rounding,
  pickupCents: PROVISIONAL_RULE.pickupCents,
  perKmCents: PROVISIONAL_RULE.perKmCents,
  minimumCents: PROVISIONAL_RULE.minimumCents,
};

let totalCents: number;

function setupIntent(overrides: Partial<SetupIntentFixture> = {}): SetupIntentFixture {
  return {
    id: "seti_RouteTest1",
    status: "succeeded",
    usage: "off_session",
    livemode: false,
    fromBookingRequestFlow: true,
    customerId: "cus_RouteTest1",
    customerEmail: "guest@avelys.test",
    paymentMethodId: "pm_RouteTest1",
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    origin: { label: "Test origin", lat: 48.8443, lng: 2.3743 },
    destination: { label: "Test destination", lat: 49.0097, lng: 2.5479, placeId: "test-place" },
    pickupLocalDateTime: "2026-10-25T03:00",
    passengers: 2,
    luggage: 1,
    customer: { name: "Guest Test", email: "Guest@Avelys.test" },
    termsAccepted: true,
    displayedTotal: { amountCents: totalCents, currency: "EUR" },
    paymentSetupId: "seti_RouteTest1",
    ...overrides,
  };
}

function post(payload: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    }),
  );
}

async function counts() {
  const client = db();
  return {
    customers: await client.customer.count(),
    bookings: await client.booking.count(),
    payments: await client.payment.count(),
    audits: await client.auditLog.count({ where: { entityType: { in: ["Booking", "Payment"] } } }),
  };
}

const NOTHING = { customers: 0, bookings: 0, payments: 0, audits: 0 };

describe("POST /api/v1/bookings (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.auditLog.deleteMany();
    await client.payment.deleteMany();
    await client.notification.deleteMany();
    await client.booking.deleteMany();
    await client.customer.deleteMany();
    await client.pricingRule.deleteMany();
    const rule = await createPricingRuleVersion(
      { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), tariff: TARIFF },
      { type: "SYSTEM" },
    );
    totalCents = computeBaseFare(rule, ROUTE).total.amountCents;
    mocks.computeRoute.mockReset().mockResolvedValue(RESOLVED);
    mocks.retrieveSetupIntent.mockReset().mockResolvedValue(setupIntent());
    mocks.gateway.mockReset().mockImplementation(() => ({
      createSetupIntent: () => Promise.reject(new Error("not used")),
      retrieveSetupIntent: mocks.retrieveSetupIntent,
    }));
  });

  afterAll(async () => {
    await db().auditLog.deleteMany({ where: { entityType: { in: ["Booking", "Payment"] } } });
    await db().payment.deleteMany();
    await db().notification.deleteMany();
    await db().booking.deleteMany();
    await db().customer.deleteMany();
    await db().$disconnect();
  });

  it("creates a REQUESTED booking and its PENDING payment, audited under a server correlation id", async () => {
    const response = await post(body(), { "x-request-id": "client-chosen-id-123" });
    expect(response.status).toBe(201);
    const json = (await response.json()) as { booking: { reference: string; status: string } };
    expect(json).toEqual({ booking: { reference: expect.any(String), status: "REQUESTED" } });

    const booking = await db().booking.findUniqueOrThrow({
      where: { reference: json.booking.reference },
      include: { payments: true },
    });
    expect(booking.status).toBe("REQUESTED");
    expect(booking.totalTtcCents).toBe(totalCents);
    expect(booking.payments).toMatchObject([
      { status: "PENDING", stripeSetupIntentId: "seti_RouteTest1", amountCents: totalCents },
    ]);

    const correlationId = response.headers.get("x-request-id");
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    const audits = await db().auditLog.findMany({
      where: { entityType: { in: ["Booking", "Payment"] } },
    });
    expect(audits).toHaveLength(2);
    for (const audit of audits) expect(audit.correlationId).toBe(correlationId);
  });

  it("replays a second submission: same reference, no write, no Stripe or Maps call", async () => {
    const first = await post(body());
    const firstJson: unknown = await first.json();
    const after = await counts();
    mocks.computeRoute.mockClear();
    mocks.retrieveSetupIntent.mockClear();
    mocks.gateway.mockClear();

    const second = await post(
      body({ customer: { name: "Guest Test", email: " guest@AVELYS.test" } }),
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual(firstJson);
    await expect(counts()).resolves.toEqual(after);
    expect(mocks.computeRoute).not.toHaveBeenCalled();
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it("refuses a replay under another email with 422, writing nothing more", async () => {
    await post(body());
    const after = await counts();

    const response = await post(
      body({ customer: { name: "Other Guest", email: "other-guest@avelys.test" } }),
    );
    expect(response.status).toBe(422);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PAYMENT_METHOD_REQUIRED");
    await expect(counts()).resolves.toEqual(after);
  });

  it("refuses a SetupIntent saved for another email with 422 and writes nothing", async () => {
    mocks.retrieveSetupIntent.mockResolvedValue(
      setupIntent({ customerEmail: "other@avelys.test" }),
    );
    const response = await post(body());
    expect(response.status).toBe(422);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PAYMENT_METHOD_REQUIRED");
    await expect(counts()).resolves.toEqual(NOTHING);
  });

  it("answers two concurrent submissions with one booking and identical bodies", async () => {
    // Both requests pass the replay lookup, then meet in the (mocked) routing call before either
    // writes: the race on the SetupIntent is real.
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.computeRoute.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      return RESOLVED;
    });

    const responses = await Promise.all([post(body()), post(body())]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 201]);
    const [first, second] = await Promise.all(responses.map((response) => response.json()));
    expect(second).toEqual(first);
    expect(mocks.computeRoute).toHaveBeenCalledTimes(2);

    const after = await counts();
    expect(after).toEqual({ customers: 1, bookings: 1, payments: 1, audits: 2 });
  });

  it("answers 503 PAYMENT_UNAVAILABLE on a Stripe outage, without its message, writing nothing", async () => {
    mocks.retrieveSetupIntent.mockRejectedValue(
      new Stripe.errors.StripeAPIError({
        type: "api_error",
        message: "Stripe is down for guest@avelys.test",
      }),
    );
    const response = await post(body());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: "PAYMENT_UNAVAILABLE" } });
    expect(text).not.toMatch(/Stripe is down|guest/);
    await expect(counts()).resolves.toEqual(NOTHING);
  });

  it("answers 503 PAYMENT_UNAVAILABLE when the Stripe key is missing, writing nothing", async () => {
    mocks.gateway.mockImplementation(() => {
      throw mocks.configError?.("not_configured") ?? new Error("mock not initialised");
    });
    const response = await post(body());
    expect(response.status).toBe(503);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PAYMENT_UNAVAILABLE");
    await expect(counts()).resolves.toEqual(NOTHING);
  });
});
