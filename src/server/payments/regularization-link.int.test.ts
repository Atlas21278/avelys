import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Test-only values built at run time, set before the environment is first read: not secrets,
// no key literal in the repository.
const LINK_KEY = "integration-tests-only-payment-link-key-0000";
process.env.PAYMENT_LINK_SECRET = LINK_KEY;
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = ["pk", "test", "IntegrationFake000"].join("_");

const { signRegularizationToken } = await import("@/domain/payment/regularization-token");
const { db } = await import("@/server/db");
const { bookingWithPayment, resetChargeData, TEST_TOTAL } = await import("@/test/charge-fixtures");
const { enrolTotp, signIn, staff } = await import("@/test/staff-session");
const { backOfficeRegularizationLink, resolveRegularizationLink } =
  await import("./regularization-link");

import type { PaymentIntentForAuthentication } from "@/integrations/stripe";
import type { ChargeFixture } from "@/test/charge-fixtures";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Stripe is an in-memory fake: no network, no key.

const BEFORE_PICKUP = new Date("2026-10-30T10:00:00Z");
const PICKUP = new Date("2026-11-02T09:00:00Z");
const PAYMENT_INTENT_ID = "pi_RegularizationTest1";
const CLIENT_SECRET = `${PAYMENT_INTENT_ID}_secret_FakeSecret1`;

let fixture: ChargeFixture;
let stripeIntent: PaymentIntentForAuthentication | null;
const retrievePaymentIntentForAuthentication = vi.fn(async () => stripeIntent);
const gateway = () => ({ retrievePaymentIntentForAuthentication });
const deps = (now = BEFORE_PICKUP) => ({ gateway, now: () => now });

function intent(change: Partial<PaymentIntentForAuthentication["intent"]> = {}) {
  return {
    intent: {
      id: PAYMENT_INTENT_ID,
      status: "requires_payment_method",
      amountCents: TEST_TOTAL,
      currency: "EUR",
      livemode: false,
      customerId: fixture.customerId,
      bookingRef: fixture.reference,
      attempt: 1,
      lastPaymentErrorCode: "authentication_required",
      lastPaymentErrorDeclineCode: null,
      ...change,
    },
    clientSecret: CLIENT_SECRET,
  };
}

/** The fixture's Payment as VTC-033 leaves it after `authentication_required`. */
async function requiresAction(fixtureToUpdate: ChargeFixture) {
  await db().payment.update({
    where: { id: fixtureToUpdate.paymentId },
    data: {
      status: "REQUIRES_ACTION",
      attempt: 1,
      stripePaymentIntentId: PAYMENT_INTENT_ID,
      version: 3,
    },
  });
}

const token = (attempt = 1, paymentId = fixture.paymentId) =>
  signRegularizationToken({ paymentId, attempt }, LINK_KEY);

async function rows() {
  const client = db();
  return {
    booking: await client.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } }),
    payment: await client.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } }),
    audit: await client.auditLog.count(),
    events: await client.processedWebhookEvent.count(),
    notifications: await client.notification.count(),
  };
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

describe("resolveRegularizationLink (integration)", () => {
  beforeEach(async () => {
    await resetChargeData();
    retrievePaymentIntentForAuthentication.mockClear();
    fixture = await bookingWithPayment();
    await requiresAction(fixture);
    stripeIntent = intent();
  });

  afterAll(async () => {
    await resetChargeData();
  });

  it("offers the authentication of the same PaymentIntent with the saved card", async () => {
    const page = await resolveRegularizationLink(token(), deps());

    expect(page).toEqual({
      kind: "authenticate",
      step: "confirm",
      summary: {
        bookingRef: fixture.reference,
        pickupAt: PICKUP,
        amountCents: TEST_TOTAL,
        currency: "EUR",
      },
      clientSecret: CLIENT_SECRET,
      paymentMethodId: expect.stringMatching(/^pm_/) as unknown,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    });
    expect(retrievePaymentIntentForAuthentication).toHaveBeenCalledWith(PAYMENT_INTENT_ID);
  });

  it("writes nothing, whatever the outcome", async () => {
    const before = await rows();

    for (const status of ["requires_payment_method", "requires_action", "succeeded", "canceled"]) {
      stripeIntent = intent({ status });
      await resolveRegularizationLink(token(), deps());
    }
    await resolveRegularizationLink(`${token()}x`, deps());

    expect(await rows()).toEqual(before);
  });

  it("runs the pending action of a requires_action PaymentIntent", async () => {
    stripeIntent = intent({ status: "requires_action", lastPaymentErrorCode: null });
    await expect(resolveRegularizationLink(token(), deps())).resolves.toMatchObject({
      kind: "authenticate",
      step: "next_action",
    });
  });

  it("shows a settled payment (webhook still to come) without offering anything", async () => {
    for (const status of ["succeeded", "processing"]) {
      stripeIntent = intent({ status });
      await expect(resolveRegularizationLink(token(), deps())).resolves.toEqual({
        kind: "settled",
        summary: expect.objectContaining({ bookingRef: fixture.reference }) as unknown,
      });
    }
  });

  it("closes a PaymentIntent that cannot be finished online", async () => {
    for (const change of [
      { status: "canceled" },
      { status: "requires_payment_method", lastPaymentErrorCode: "card_declined" },
    ]) {
      stripeIntent = intent(change);
      await expect(resolveRegularizationLink(token(), deps())).resolves.toMatchObject({
        kind: "closed",
      });
    }
  });

  it("never offers a PaymentIntent that does not match the Payment", async () => {
    for (const change of [
      { id: "pi_Other1" },
      { livemode: true },
      { customerId: "cus_Other1" },
      { attempt: 2 },
      { amountCents: TEST_TOTAL + 1 },
      { currency: "USD" },
    ]) {
      stripeIntent = intent(change);
      await expect(
        resolveRegularizationLink(token(), deps()),
        JSON.stringify(change),
      ).resolves.toMatchObject({ kind: "closed" });
    }
    stripeIntent = null;
    await expect(resolveRegularizationLink(token(), deps())).resolves.toMatchObject({
      kind: "closed",
    });
  });

  it("answers unavailable when Stripe cannot be read", async () => {
    retrievePaymentIntentForAuthentication.mockRejectedValueOnce(
      new Stripe.errors.StripeAPIError({ type: "api_error", message: "Stripe down" }),
    );
    await expect(resolveRegularizationLink(token(), deps())).resolves.toMatchObject({
      kind: "unavailable",
    });
  });

  describe("refuses with the same invalid outcome, without reading Stripe", () => {
    const invalid = { kind: "invalid" };

    afterEach(() => {
      expect(retrievePaymentIntentForAuthentication).not.toHaveBeenCalled();
    });

    it("an altered token, another key or an unknown Payment", async () => {
      const valid = token();
      const altered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;
      await expect(resolveRegularizationLink(altered, deps())).resolves.toEqual(invalid);
      const otherKey = signRegularizationToken(
        { paymentId: fixture.paymentId, attempt: 1 },
        "another-integration-test-only-key-00000000",
      );
      await expect(resolveRegularizationLink(otherKey, deps())).resolves.toEqual(invalid);
      await expect(
        resolveRegularizationLink(token(1, "unknownpaymentid000000000"), deps()),
      ).resolves.toEqual(invalid);
      await expect(resolveRegularizationLink("", deps())).resolves.toEqual(invalid);
    });

    it("a token of another attempt, and an older link after a retry", async () => {
      await expect(resolveRegularizationLink(token(2), deps())).resolves.toEqual(invalid);

      const older = token(1);
      await db().payment.update({ where: { id: fixture.paymentId }, data: { attempt: 2 } });
      await expect(resolveRegularizationLink(older, deps())).resolves.toEqual(invalid);
    });

    it.each(["PENDING", "PAID", "FAILED", "CANCELED"] as const)("a %s payment", async (status) => {
      await db().payment.update({ where: { id: fixture.paymentId }, data: { status } });
      await expect(resolveRegularizationLink(token(), deps())).resolves.toEqual(invalid);
    });

    it("a payment that is not the booking's current one", async () => {
      await db().booking.update({
        where: { id: fixture.bookingId },
        data: { currentPaymentId: null },
      });
      await expect(resolveRegularizationLink(token(), deps())).resolves.toEqual(invalid);
    });

    it.each(["REQUESTED", "CONFIRMED", "CANCELLED", "REFUSED"] as const)(
      "a %s booking",
      async (status) => {
        await db().booking.update({ where: { id: fixture.bookingId }, data: { status } });
        await expect(resolveRegularizationLink(token(), deps())).resolves.toEqual(invalid);
      },
    );

    it("once the pickup time is reached", async () => {
      await expect(resolveRegularizationLink(token(), deps(PICKUP))).resolves.toEqual(invalid);
    });
  });
});

describe("backOfficeRegularizationLink (integration)", () => {
  const sessions = { admin: new Headers(), dispatcher: new Headers() };

  beforeAll(async () => {
    await resetUsers();
    for (const role of ["ADMIN", "DISPATCHER"] as const) {
      const { jar } = await signIn(await staff(role));
      await enrolTotp(jar);
      sessions[role === "ADMIN" ? "admin" : "dispatcher"] = jar.headers();
    }
  });

  beforeEach(async () => {
    await resetChargeData();
    fixture = await bookingWithPayment();
    await requiresAction(fixture);
  });

  afterAll(async () => {
    await resetChargeData();
    await resetUsers();
    await db().$disconnect();
  });

  it("gives an ADMIN the link of the current attempt, in the customer's language", async () => {
    const link = await backOfficeRegularizationLink(sessions.admin, fixture.reference, {
      now: () => BEFORE_PICKUP,
    });
    expect(link).toEqual({ status: "available", url: `http://localhost:3000/paiement/${token()}` });

    await db().customer.updateMany({ data: { preferredLocale: "en" } });
    await expect(
      backOfficeRegularizationLink(sessions.admin, fixture.reference, { now: () => BEFORE_PICKUP }),
    ).resolves.toEqual({
      status: "available",
      url: `http://localhost:3000/en/payment/${token()}`,
    });
  });

  it("gives no link when the payment no longer waits for the customer", async () => {
    await db().payment.update({ where: { id: fixture.paymentId }, data: { status: "FAILED" } });
    await expect(
      backOfficeRegularizationLink(sessions.admin, fixture.reference, { now: () => BEFORE_PICKUP }),
    ).resolves.toEqual({ status: "not_applicable" });
  });

  it("refuses a DISPATCHER and an anonymous caller", async () => {
    await expect(
      backOfficeRegularizationLink(sessions.dispatcher, fixture.reference),
    ).rejects.toMatchObject({ name: "BackOfficeAccessError", reason: "FORBIDDEN" });
    await expect(
      backOfficeRegularizationLink(new Headers(), fixture.reference),
    ).rejects.toMatchObject({ name: "BackOfficeAccessError", reason: "UNAUTHENTICATED" });
  });
});
