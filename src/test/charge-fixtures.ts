import { randomUUID } from "node:crypto";

import { vi } from "vitest";

import type { BookingStatus } from "@/domain/booking/status";
import { computeBaseFare } from "@/domain/pricing/base-fare";
import type { PricingRuleConfigInput, RouteInput } from "@/domain/pricing/rule";
import { buildPricingSnapshot, type PricingSnapshot } from "@/domain/pricing/snapshot";
import type { Prisma } from "@/generated/prisma/client";
import type {
  OffSessionChargeInput,
  OffSessionChargeResult,
  PaymentIntentGateway,
  PaymentIntentSummary,
} from "@/integrations/stripe";
import { generateReference } from "@/server/booking/reference";
import { db } from "@/server/db";

/**
 * Integration fixtures of the off-session charge (VTC-033): accepted bookings with their
 * `PENDING` Payment inserted directly, and an in-memory Stripe PaymentIntent gateway. Test values
 * only: the rule below is not a tariff, the ids are fake.
 */

// Arbitrary test rule and route (not business values), priced by the real engine so that the
// snapshot validates like a production one.
const TEST_RULE_CONFIG: PricingRuleConfigInput = {
  schemaVersion: 1,
  id: "test-rule-charge",
  version: 1,
  currency: "EUR",
  amountBasis: "TTC",
  rounding: "halfUp",
  pickupCents: 1_000,
  perKmCents: 100,
  minimumCents: 2_000,
};
const TEST_ROUTE: RouteInput = {
  distanceMeters: 31_250,
  durationSeconds: 2_400,
  provider: "test",
  computedAt: "2026-09-30T08:00:00Z",
};

export const TEST_SNAPSHOT: PricingSnapshot = buildPricingSnapshot({
  fare: computeBaseFare(TEST_RULE_CONFIG, TEST_ROUTE),
  inputs: {
    origin: { lat: 48.8443, lng: 2.3743 },
    destination: { lat: 49.0097, lng: 2.5479 },
    pickupLocalDateTime: "2026-11-02T10:00",
    timeZone: "Europe/Paris",
    pickupAt: "2026-11-02T09:00:00.000Z",
    passengers: 2,
    luggage: 1,
  },
  resolvedPoints: {
    origin: { lat: 48.8443, lng: 2.3743 },
    destination: { lat: 49.0097, lng: 2.5479 },
  },
  quotedAt: new Date("2026-09-30T08:00:00Z"),
});
export const TEST_TOTAL = TEST_SNAPSHOT.totals.ttcCents;

export async function resetChargeData(): Promise<void> {
  const client = db();
  await client.processedWebhookEvent.deleteMany();
  await client.auditLog.deleteMany();
  await client.notification.deleteMany();
  await client.booking.updateMany({ data: { currentPaymentId: null } });
  await client.payment.deleteMany();
  await client.booking.deleteMany();
  await client.customer.deleteMany();
  await client.pricingRule.deleteMany();
  await client.pricingRule.create({
    data: {
      id: TEST_RULE_CONFIG.id,
      version: TEST_RULE_CONFIG.version,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      config: { note: "test rule, not a tariff" },
      schemaVersion: 1,
    },
  });
}

export type ChargeFixture = Readonly<{
  bookingId: string;
  reference: string;
  paymentId: string;
  customerId: string;
}>;

/** An accepted booking (by default) with its untouched `PENDING` Payment as current Payment. */
export async function bookingWithPayment(
  options: { status?: BookingStatus; paymentAmountCents?: number; link?: boolean } = {},
): Promise<ChargeFixture> {
  const client = db();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const customer = await client.customer.create({
    data: { name: "Client Test", email: `client-${suffix}@avelys.test` },
  });
  const pickupAt = new Date("2026-11-02T09:00:00Z");
  const booking = await client.booking.create({
    data: {
      reference: generateReference(),
      customerId: customer.id,
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
      quotedDistanceMeters: TEST_ROUTE.distanceMeters,
      quotedDurationSeconds: TEST_ROUTE.durationSeconds,
      totalTtcCents: TEST_TOTAL,
      currency: "EUR",
      pricingSnapshot: TEST_SNAPSHOT as unknown as Prisma.InputJsonValue,
      pricingRuleId: TEST_RULE_CONFIG.id,
      pricingRuleVersion: TEST_RULE_CONFIG.version,
      status: options.status ?? "ACCEPTED",
      version: 2,
    },
    select: { id: true, reference: true },
  });
  const stripeCustomerId = `cus_${suffix}`;
  const payment = await client.payment.create({
    data: {
      bookingId: booking.id,
      amountCents: options.paymentAmountCents ?? TEST_TOTAL,
      currency: "EUR",
      stripeCustomerId,
      stripeSetupIntentId: `seti_${suffix}`,
      stripePaymentMethodId: `pm_${suffix}`,
    },
    select: { id: true },
  });
  if (options.link ?? true) {
    await client.booking.update({
      where: { id: booking.id },
      data: { currentPaymentId: payment.id },
    });
  }
  return {
    bookingId: booking.id,
    reference: booking.reference,
    paymentId: payment.id,
    customerId: stripeCustomerId,
  };
}

export async function chargeState(fixture: ChargeFixture) {
  const client = db();
  const [booking, payment] = await Promise.all([
    client.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { status: true, version: true, currentPaymentId: true },
    }),
    client.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId },
      select: { status: true, attempt: true, version: true, stripePaymentIntentId: true },
    }),
  ]);
  return { booking, payment };
}

export function auditActions(entityId: string) {
  return db()
    .auditLog.findMany({
      where: { entityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, actorType: true, before: true, after: true },
    })
    .then((rows) => rows);
}

/** Outcome the fake Stripe gives to the next confirmations. */
export type FakeConfirmation =
  Readonly<{ status: string; errorCode: string | null }> | Readonly<{ throws: Error }>;

/**
 * In-memory PaymentIntent gateway honouring idempotency keys: the same key returns the same
 * PaymentIntent without a second confirmation, like Stripe.
 */
export function fakePaymentIntents() {
  const intents = new Map<string, PaymentIntentSummary>();
  const byKey = new Map<string, OffSessionChargeResult>();
  let confirmation: FakeConfirmation = { status: "succeeded", errorCode: null };
  let beforeAnswer: ((intent: PaymentIntentSummary) => Promise<void>) | null = null;

  const createOffSessionCharge = vi.fn(
    async (input: OffSessionChargeInput): Promise<OffSessionChargeResult> => {
      const known = byKey.get(input.idempotencyKey);
      if (known) return known;
      if ("throws" in confirmation) throw confirmation.throws;
      const intent: PaymentIntentSummary = {
        id: `pi_${randomUUID().replaceAll("-", "")}`,
        status: confirmation.status,
        amountCents: input.amountCents,
        currency: input.currency.toUpperCase(),
        livemode: false,
        customerId: input.customerId,
        bookingRef: input.bookingRef,
        attempt: input.attempt,
        lastPaymentErrorCode: confirmation.errorCode,
      };
      intents.set(intent.id, intent);
      const result = { intent, errorCode: confirmation.errorCode };
      byKey.set(input.idempotencyKey, result);
      if (beforeAnswer) await beforeAnswer(intent);
      return result;
    },
  );

  const gateway: PaymentIntentGateway = {
    createOffSessionCharge,
    listCustomerPaymentIntents: vi.fn(async (customerId: string) =>
      [...intents.values()].filter((intent) => intent.customerId === customerId).reverse(),
    ),
    retrievePaymentIntent: vi.fn(async (id: string) => intents.get(id) ?? null),
  };

  return {
    gateway,
    createOffSessionCharge,
    intents,
    confirmWith(next: FakeConfirmation) {
      confirmation = next;
    },
    /** Runs `hook` after the PaymentIntent exists at Stripe, before the synchronous answer. */
    beforeAnswer(hook: ((intent: PaymentIntentSummary) => Promise<void>) | null) {
      beforeAnswer = hook;
    },
    /** Stores a PaymentIntent as if created elsewhere (earlier attempt, dashboard…). */
    put(intent: PaymentIntentSummary) {
      intents.set(intent.id, intent);
    },
    /** Changes the Stripe state of a PaymentIntent (e.g. processing → succeeded). */
    update(id: string, change: Partial<PaymentIntentSummary>) {
      const current = intents.get(id);
      if (!current) throw new Error("unknown fake PaymentIntent");
      intents.set(id, { ...current, ...change });
    },
  };
}
