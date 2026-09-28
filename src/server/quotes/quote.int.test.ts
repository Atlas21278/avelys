import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import { parsePricingSnapshot } from "@/domain/pricing/snapshot";
import type { RoutingProvider } from "@/integrations/maps/routing";
import { generateReference } from "@/server/booking/reference";
import { db } from "@/server/db";
import {
  createPricingRuleVersion,
  getActivePricingRule,
  type PricingRuleTariffInput,
} from "@/server/pricing/rules";

import { computeQuote, QuoteError, type QuoteDeps } from "./quote";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Routing is mocked: tests never call Google.

// Tariff of the test fixture (PROVISIONAL — DEC-03), without the identity held by the columns.
const TARIFF: PricingRuleTariffInput = {
  currency: PROVISIONAL_RULE.currency,
  amountBasis: PROVISIONAL_RULE.amountBasis,
  rounding: PROVISIONAL_RULE.rounding,
  pickupCents: PROVISIONAL_RULE.pickupCents,
  perKmCents: PROVISIONAL_RULE.perKmCents,
  minimumCents: PROVISIONAL_RULE.minimumCents,
};
const SYSTEM = { type: "SYSTEM" } as const;

const NOW = new Date("2026-09-28T08:00:00.000Z");
const ROUTE = route({
  distanceMeters: 31_250,
  durationSeconds: 2_400,
  computedAt: NOW.toISOString(),
});

// 2026-10-25 03:00 in Paris, just after the autumn change (UTC+1) = 02:00Z.
const REQUEST = {
  origin: { lat: 48.8443, lng: 2.3743, label: "Test origin" },
  destination: { lat: 49.0097, lng: 2.5479, label: "Test destination" },
  pickupLocalDateTime: "2026-10-25T03:00",
  passengers: 2,
  luggage: 1,
};

function deps(): QuoteDeps {
  const computeRoute = vi.fn<RoutingProvider["computeRoute"]>().mockResolvedValue(ROUTE);
  return {
    routing: { computeRoute },
    activePricingRule: getActivePricingRule,
    now: () => NOW,
    // Arbitrary test lead time, not the business value (BR-31).
    minLeadTimeMinutes: 60,
  };
}

describe("quote service (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.auditLog.deleteMany();
    await client.booking.deleteMany();
    await client.customer.deleteMany();
    await client.pricingRule.deleteMany();
  });

  afterAll(async () => {
    // Leave no booking behind: stale rows would break later foreign key validations.
    await db().booking.deleteMany();
    await db().$disconnect();
  });

  it("refuses to price when no rule is active", async () => {
    const error: unknown = await computeQuote(REQUEST, deps()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuoteError);
    expect((error as QuoteError).code).toBe("NO_ACTIVE_PRICING_RULE");
  });

  it("prices with the seeded rule and persists a snapshot that survives a new rule version", async () => {
    const rule = await createPricingRuleVersion(
      { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), tariff: TARIFF },
      SYSTEM,
    );

    const quote = await computeQuote(REQUEST, deps());
    expect(quote.total).toEqual(computeBaseFare(rule, ROUTE).total);
    expect(quote.snapshot.rule).toEqual(rule);
    expect(quote.pickupAt).toEqual(new Date("2026-10-25T02:00:00.000Z"));

    // What the booking service (VTC-028) will store: the snapshot copied into the Booking.
    const customer = await db().customer.create({
      data: { name: "Guest Test", email: "guest@avelys.test" },
    });
    const { snapshot } = quote;
    const booking = await db().booking.create({
      data: {
        reference: generateReference(),
        customerId: customer.id,
        pickupLabel: REQUEST.origin.label,
        pickupLat: REQUEST.origin.lat,
        pickupLng: REQUEST.origin.lng,
        dropoffLabel: REQUEST.destination.label,
        dropoffLat: REQUEST.destination.lat,
        dropoffLng: REQUEST.destination.lng,
        pickupAt: quote.pickupAt,
        pickupLocalDateTime: new Date(`${snapshot.inputs.pickupLocalDateTime}:00.000Z`),
        pickupTimeZone: snapshot.inputs.timeZone,
        passengerCount: snapshot.inputs.passengers,
        luggageCount: snapshot.inputs.luggage,
        quotedDistanceMeters: snapshot.route.distanceMeters,
        quotedDurationSeconds: snapshot.route.durationSeconds,
        totalTtcCents: snapshot.totals.ttcCents,
        totalHtCents: snapshot.totals.htCents,
        vatCents: snapshot.totals.vatCents,
        currency: snapshot.totals.currency,
        pricingSnapshot: snapshot,
        pricingRuleId: snapshot.rule.id,
        pricingRuleVersion: snapshot.rule.version,
      },
    });

    // A later tariff version (test values, not a tariff) changes new quotes only (BR-13).
    await createPricingRuleVersion(
      {
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        tariff: { ...TARIFF, perKmCents: 300 },
      },
      SYSTEM,
    );
    const requote = await computeQuote(REQUEST, deps());
    expect(requote.total.amountCents).toBeGreaterThan(quote.total.amountCents);
    expect(requote.snapshotId).not.toBe(quote.snapshotId);

    const stored = await db().booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(parsePricingSnapshot(stored.pricingSnapshot)).toEqual(snapshot);
    expect(stored.totalTtcCents).toBe(quote.total.amountCents);
    expect(stored.pricingRuleVersion).toBe(rule.version);
  });
});
