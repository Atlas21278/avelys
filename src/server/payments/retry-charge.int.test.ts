import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";
import {
  auditActions,
  bookingWithPayment,
  chargeState,
  fakePaymentIntents,
  resetChargeData,
  TEST_TOTAL,
  type ChargeFixture,
} from "@/test/charge-fixtures";
import { enrolTotp, signIn, staff } from "@/test/staff-session";

import type { OnPaymentRequiresAction } from "./after-charge";
import { chargeBooking } from "./charge-booking";
import { processStripeWebhookEvent } from "./process-webhook";
import { ChargeRetryError, retryBookingCharge, type RetryChargeActor } from "./retry-charge";
import { runChargeRetry } from "./retry-charge-action";
import { createPaymentIntentWebhookHandlers } from "./webhook-handlers";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Stripe is an in-memory fake (no network, no key): see src/test/charge-fixtures.ts.

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: () => log }));

let stripe = fakePaymentIntents();
const onPaymentRequiresAction = vi.fn<OnPaymentRequiresAction>();
const deps = () => ({ gateway: () => stripe.gateway, onPaymentRequiresAction });

const sessions = {
  admin: new Headers(),
  dispatcher: new Headers(),
  driver: new Headers(),
  unenrolled: new Headers(),
};
const userIds = { admin: "" };
const admin = () => ({ role: "ADMIN" as const, userId: userIds.admin });

async function resetUsers() {
  const client = db();
  await client.session.deleteMany();
  await client.account.deleteMany();
  await client.twoFactor.deleteMany();
  await client.verification.deleteMany();
  await client.rateLimit.deleteMany();
  await client.user.deleteMany();
}

/** An ACCEPTED booking whose first charge was declined: Payment FAILED, attempt 1. */
async function failedBooking(errorCode = "card_declined") {
  const fixture = await bookingWithPayment();
  stripe.confirmWith({ status: "requires_payment_method", errorCode });
  await chargeBooking(fixture.bookingId, deps());
  const { payment } = await chargeState(fixture);
  expect(payment.status).toBe("FAILED");
  const previousIntentId = payment.stripePaymentIntentId ?? "";
  stripe.confirmWith({ status: "succeeded", errorCode: null });
  stripe.createOffSessionCharge.mockClear();
  return { fixture, version: payment.version, previousIntentId };
}

/** An ACCEPTED booking whose first charge got no outcome: Payment PENDING, attempt 1. */
async function interruptedBooking() {
  const fixture = await bookingWithPayment();
  stripe.confirmWith({ throws: new Stripe.errors.StripeAPIError({ type: "api_error" }) });
  await chargeBooking(fixture.bookingId, deps());
  const { payment } = await chargeState(fixture);
  expect(payment).toMatchObject({ status: "PENDING", attempt: 1 });
  stripe.confirmWith({ status: "succeeded", errorCode: null });
  stripe.createOffSessionCharge.mockClear();
  return { fixture, version: payment.version };
}

function retry(fixture: ChargeFixture, version: number, actor: RetryChargeActor = admin()) {
  return retryBookingCharge(fixture.reference, version, actor, deps());
}

async function retryError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ChargeRetryError);
  return (error as ChargeRetryError).code;
}

describe("manual charge retry (integration)", () => {
  beforeAll(async () => {
    await resetChargeData();
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
    userIds.admin =
      (await db().user.findUnique({ where: { email: "admin@avelys.test" } }))?.id ?? "";
  });

  beforeEach(async () => {
    stripe = fakePaymentIntents();
    onPaymentRequiresAction.mockReset();
    onPaymentRequiresAction.mockResolvedValue(undefined);
    vi.clearAllMocks();
    await resetChargeData();
  });

  afterAll(async () => {
    await resetChargeData();
    await resetUsers();
    await db().$disconnect();
  });

  describe("service", () => {
    it("retries a FAILED charge: cancels the old PaymentIntent, charges, confirms the booking", async () => {
      const { fixture, version, previousIntentId } = await failedBooking();

      await expect(retry(fixture, version)).resolves.toEqual({
        outcome: "charged",
        reference: fixture.reference,
        attempt: 2,
        paymentStatus: "PAID",
        bookingStatus: "CONFIRMED",
      });

      expect(stripe.cancelPaymentIntent).toHaveBeenCalledExactlyOnceWith(
        previousIntentId,
        `booking:${fixture.bookingId}:cancel:1`,
      );
      expect(stripe.intents.get(previousIntentId)?.status).toBe("canceled");
      expect(stripe.createOffSessionCharge).toHaveBeenCalledExactlyOnceWith({
        customerId: fixture.customerId,
        paymentMethodId: expect.stringMatching(/^pm_/) as unknown,
        amountCents: TEST_TOTAL,
        currency: "EUR",
        bookingRef: fixture.reference,
        attempt: 2,
        idempotencyKey: `booking:${fixture.bookingId}:charge:2`,
      });

      // Same Payment row: attempt incremented, PaymentIntent replaced, current pointer unchanged.
      const { booking, payment } = await chargeState(fixture);
      expect(payment).toMatchObject({ status: "PAID", attempt: 2 });
      expect(payment.stripePaymentIntentId).toMatch(/^pi_/);
      expect(payment.stripePaymentIntentId).not.toBe(previousIntentId);
      expect(booking).toMatchObject({ status: "CONFIRMED", currentPaymentId: fixture.paymentId });
      expect(await db().payment.count({ where: { bookingId: fixture.bookingId } })).toBe(1);

      const paymentAudit = await auditActions(fixture.paymentId);
      expect(paymentAudit.map((row) => row.action)).toEqual([
        "payment.charge_attempt",
        "payment.charge",
        "payment.retry",
        "payment.charge",
      ]);
      expect(paymentAudit[2]).toEqual({
        action: "payment.retry",
        actorType: "ADMIN",
        before: {
          bookingRef: fixture.reference,
          status: "FAILED",
          amountCents: TEST_TOTAL,
          currency: "EUR",
          version,
          attempt: 1,
          paymentIntentId: previousIntentId,
        },
        after: {
          bookingRef: fixture.reference,
          status: "FAILED",
          amountCents: TEST_TOTAL,
          currency: "EUR",
          version: version + 1,
          attempt: 2,
        },
      });
      const retryRow = await db().auditLog.findFirstOrThrow({ where: { action: "payment.retry" } });
      expect(retryRow.actorId).toBe(userIds.admin);
      expect(paymentAudit[3]).toMatchObject({
        before: { status: "FAILED", attempt: 2 },
        after: { status: "PAID", attempt: 2, paymentIntentId: payment.stripePaymentIntentId },
      });
    });

    it("keeps the booking ACCEPTED when the retry is declined again (FAILED kept, new PaymentIntent)", async () => {
      const { fixture, version, previousIntentId } = await failedBooking();
      stripe.confirmWith({ status: "requires_payment_method", errorCode: "insufficient_funds" });

      await expect(retry(fixture, version)).resolves.toMatchObject({
        outcome: "charged",
        attempt: 2,
        paymentStatus: "FAILED",
        bookingStatus: "ACCEPTED",
      });
      const { booking, payment } = await chargeState(fixture);
      expect(payment).toMatchObject({ status: "FAILED", attempt: 2 });
      expect(payment.stripePaymentIntentId).not.toBe(previousIntentId);
      expect(booking.status).toBe("ACCEPTED");
    });

    it("moves to REQUIRES_ACTION when the bank asks for authentication, and calls the port", async () => {
      const { fixture, version } = await failedBooking();
      stripe.confirmWith({
        status: "requires_payment_method",
        errorCode: "authentication_required",
      });

      await expect(retry(fixture, version)).resolves.toMatchObject({
        paymentStatus: "REQUIRES_ACTION",
        bookingStatus: "ACCEPTED",
      });
      expect(onPaymentRequiresAction).toHaveBeenCalledExactlyOnceWith(fixture.paymentId);
    });

    it("retries a first attempt interrupted by a technical error (PENDING, attempt 1)", async () => {
      const { fixture, version } = await interruptedBooking();

      await expect(retry(fixture, version)).resolves.toMatchObject({
        outcome: "charged",
        attempt: 2,
        paymentStatus: "PAID",
        bookingStatus: "CONFIRMED",
      });
      expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
      expect((await auditActions(fixture.paymentId))[1]).toMatchObject({
        action: "payment.retry",
        before: { status: "PENDING", attempt: 1 },
      });
    });

    it("reconciles a payment Stripe already took, without charging again", async () => {
      const fixture = await bookingWithPayment();
      // The first charge succeeded at Stripe but its answer was lost.
      stripe.confirmWith({ status: "succeeded", errorCode: null });
      stripe.beforeAnswer(async () => {
        throw new Stripe.errors.StripeConnectionError({ type: "api_error", message: "lost" });
      });
      await chargeBooking(fixture.bookingId, deps());
      stripe.beforeAnswer(null);
      stripe.createOffSessionCharge.mockClear();
      const { payment: before } = await chargeState(fixture);
      expect(before).toMatchObject({ status: "PENDING", attempt: 1, stripePaymentIntentId: null });

      await expect(retry(fixture, before.version)).resolves.toEqual({
        outcome: "reconciled",
        reference: fixture.reference,
        attempt: 1,
        paymentStatus: "PAID",
        bookingStatus: "CONFIRMED",
      });
      expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
      expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
      const { booking, payment } = await chargeState(fixture);
      expect(payment).toMatchObject({ status: "PAID", attempt: 1 });
      expect(booking.status).toBe("CONFIRMED");
      const actions = (await auditActions(fixture.paymentId)).map((row) => row.action);
      expect(actions).toEqual(["payment.charge_attempt", "payment.charge"]);
      expect(await auditActions(fixture.bookingId)).toMatchObject([
        { action: "booking.confirm", actorType: "SYSTEM" },
      ]);
    });

    it("reconciles when the old PaymentIntent succeeds while it is being cancelled", async () => {
      const { fixture, version, previousIntentId } = await failedBooking();
      stripe.beforeCancel(async (id) => {
        stripe.update(id, {
          status: "succeeded",
          lastPaymentErrorCode: null,
          lastPaymentErrorDeclineCode: null,
        });
      });

      await expect(retry(fixture, version)).resolves.toMatchObject({
        outcome: "reconciled",
        paymentStatus: "PAID",
        bookingStatus: "CONFIRMED",
      });
      expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
      const { payment } = await chargeState(fixture);
      expect(payment).toMatchObject({
        status: "PAID",
        attempt: 1,
        stripePaymentIntentId: previousIntentId,
      });
    });

    it("refuses while a PaymentIntent is processing, and writes nothing", async () => {
      const { fixture, version, previousIntentId } = await failedBooking();
      stripe.update(previousIntentId, { status: "processing" });

      expect(await retryError(retry(fixture, version))).toBe("PAYMENT_IN_PROGRESS");
      expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
      expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
      expect((await chargeState(fixture)).payment).toMatchObject({
        status: "FAILED",
        attempt: 1,
        version,
      });
      expect((await auditActions(fixture.paymentId)).map((row) => row.action)).not.toContain(
        "payment.retry",
      );
    });

    it("never retries from REQUIRES_ACTION (the customer link handles it)", async () => {
      const fixture = await bookingWithPayment();
      stripe.confirmWith({
        status: "requires_payment_method",
        errorCode: "authentication_required",
      });
      await chargeBooking(fixture.bookingId, deps());
      const { payment } = await chargeState(fixture);

      expect(await retryError(retry(fixture, payment.version))).toBe("PAYMENT_NOT_RETRYABLE");
      expect(stripe.gateway.listCustomerPaymentIntents).toHaveBeenCalledTimes(1);
      expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
    });

    it.each([
      ["an untouched PENDING payment", async () => bookingWithPayment()],
      ["a REQUESTED booking", async () => bookingWithPayment({ status: "REQUESTED" })],
    ])("refuses %s", async (_label, make) => {
      const fixture = await make();
      expect(await retryError(retry(fixture, 1))).toBe("PAYMENT_NOT_RETRYABLE");
      expect(stripe.gateway.listCustomerPaymentIntents).not.toHaveBeenCalled();
    });

    it("refuses a current Payment that belongs to another booking", async () => {
      const { fixture, version } = await failedBooking();
      const other = await bookingWithPayment({ link: false });
      await db().booking.update({
        where: { id: fixture.bookingId },
        data: { currentPaymentId: other.paymentId },
      });

      expect(await retryError(retry(fixture, version))).toBe("PAYMENT_STATE_INCONSISTENT");
      expect(stripe.gateway.listCustomerPaymentIntents).toHaveBeenCalledTimes(1);
      expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
    });

    it("refuses a stale version before calling Stripe", async () => {
      const { fixture, version } = await failedBooking();
      const listed = vi.mocked(stripe.gateway.listCustomerPaymentIntents).mock.calls.length;

      expect(await retryError(retry(fixture, version - 1))).toBe("PAYMENT_CONCURRENT_UPDATE");
      expect(stripe.gateway.listCustomerPaymentIntents).toHaveBeenCalledTimes(listed);
    });

    it("lets exactly one of two concurrent retries charge", async () => {
      const { fixture, version } = await failedBooking();

      const results = await Promise.allSettled([retry(fixture, version), retry(fixture, version)]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "PAYMENT_CONCURRENT_UPDATE",
      });
      expect(stripe.createOffSessionCharge).toHaveBeenCalledOnce();
      const actions = (await auditActions(fixture.paymentId)).map((row) => row.action);
      expect(actions.filter((action) => action === "payment.retry")).toHaveLength(1);
      expect((await chargeState(fixture)).payment).toMatchObject({ status: "PAID", attempt: 2 });
    });

    it("writes nothing when Stripe cannot be checked", async () => {
      const { fixture, version } = await failedBooking();
      vi.mocked(stripe.gateway.listCustomerPaymentIntents).mockRejectedValueOnce(
        new Stripe.errors.StripeConnectionError({ type: "api_error", message: "down" }),
      );

      expect(await retryError(retry(fixture, version))).toBe("PAYMENT_UNAVAILABLE");
      expect((await chargeState(fixture)).payment).toMatchObject({
        status: "FAILED",
        attempt: 1,
        version,
      });
    });

    it("keeps the reserved attempt when the new charge gets no answer; the next retry goes on", async () => {
      const { fixture, version } = await failedBooking();
      stripe.confirmWith({ throws: new Stripe.errors.StripeAPIError({ type: "api_error" }) });

      expect(await retryError(retry(fixture, version))).toBe("PAYMENT_ATTEMPT_INTERRUPTED");
      const { booking, payment } = await chargeState(fixture);
      expect(payment).toEqual({
        status: "FAILED",
        attempt: 2,
        version: version + 1,
        stripePaymentIntentId: null,
      });
      expect(booking.status).toBe("ACCEPTED");

      stripe.confirmWith({ status: "succeeded", errorCode: null });
      await expect(retry(fixture, version + 1)).resolves.toMatchObject({
        attempt: 3,
        paymentStatus: "PAID",
      });
      expect(stripe.createOffSessionCharge).toHaveBeenLastCalledWith(
        expect.objectContaining({ idempotencyKey: `booking:${fixture.bookingId}:charge:3` }),
      );
    });

    it("ignores a late webhook of the previous attempt", async () => {
      const { fixture, version, previousIntentId } = await failedBooking();
      stripe.confirmWith({ status: "requires_payment_method", errorCode: "card_declined" });
      await retry(fixture, version);
      const before = await chargeState(fixture);

      const outcome = await processStripeWebhookEvent(
        {
          id: `evt_${randomUUID().replaceAll("-", "")}`,
          object: "event",
          type: "payment_intent.payment_failed",
          livemode: false,
          created: 1_790_000_000,
          data: { object: { id: previousIntentId, object: "payment_intent" } },
        } as unknown as Stripe.Event,
        { handlers: createPaymentIntentWebhookHandlers({ gateway: () => stripe.gateway }) },
      );

      expect(outcome).toMatchObject({ outcome: "processed" });
      expect(await chargeState(fixture)).toEqual(before);
    });

    it("refuses a DISPATCHER or DRIVER actor at the service too", async () => {
      const { fixture, version } = await failedBooking();
      for (const role of ["DISPATCHER", "DRIVER"] as const) {
        expect(await retryError(retry(fixture, version, { role, userId: "u1" }))).toBe(
          "ACCESS_DENIED",
        );
      }
      expect((await chargeState(fixture)).payment.attempt).toBe(1);
    });

    it("never logs a Stripe id or customer data (BR-60)", async () => {
      const { fixture, version } = await failedBooking();
      await retry(fixture, version);

      const logged = JSON.stringify([
        log.info.mock.calls,
        log.warn.mock.calls,
        log.error.mock.calls,
      ]);
      expect(logged).not.toMatch(/\b(pi|cus|pm|seti)_[A-Za-z0-9]/);
      expect(logged).not.toContain("@avelys.test");
      expect(logged).toContain(fixture.reference);
    });
  });

  describe("action body (session, ADMIN role and 2FA re-checked)", () => {
    it("retries for an ADMIN with 2FA and records the session user", async () => {
      const { fixture, version } = await failedBooking();

      const result = await runChargeRetry(
        sessions.admin,
        { reference: fixture.reference.toLowerCase(), expectedPaymentVersion: String(version) },
        deps(),
      );

      expect(result).toMatchObject({ ok: true, outcome: "charged", paymentStatus: "PAID" });
      const row = await db().auditLog.findFirstOrThrow({ where: { action: "payment.retry" } });
      expect(row).toMatchObject({ actorType: "ADMIN", actorId: userIds.admin });
      expect(row.correlationId).toEqual(expect.any(String));
    });

    it.each([
      ["no session", () => new Headers()],
      ["a DISPATCHER", () => sessions.dispatcher],
      ["a DRIVER", () => sessions.driver],
      ["an ADMIN without 2FA", () => sessions.unenrolled],
    ] as const)("refuses %s with ACCESS_DENIED and writes nothing", async (_label, headers) => {
      const { fixture, version } = await failedBooking();

      const result = await runChargeRetry(
        headers(),
        { reference: fixture.reference, expectedPaymentVersion: version },
        deps(),
      );

      expect(result).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
      expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
      expect((await chargeState(fixture)).payment).toMatchObject({ status: "FAILED", attempt: 1 });
    });

    it.each([
      ["a malformed reference", { reference: "not a reference", expectedPaymentVersion: "1" }],
      ["a missing version", { reference: "VTC-ABCD2345" }],
      ["an extra field", { reference: "VTC-ABCD2345", expectedPaymentVersion: 1, amount: 1 }],
    ])("refuses %s with INVALID_INPUT", async (_label, input) => {
      await expect(runChargeRetry(sessions.admin, input, deps())).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_INPUT", message: expect.any(String) },
      });
    });

    it("maps a refusal to its code with a French message and the correlation id", async () => {
      const headers = new Headers(sessions.admin);
      headers.set("x-request-id", "req-retry0123456");
      const result = await runChargeRetry(
        headers,
        { reference: "VTC-ABCD2345", expectedPaymentVersion: 1 },
        deps(),
      );
      expect(result).toEqual({
        ok: false,
        error: {
          code: "BOOKING_NOT_FOUND",
          message: "Cette réservation est introuvable.",
          correlationId: "req-retry0123456",
        },
      });
    });
  });
});
