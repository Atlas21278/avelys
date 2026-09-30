import { randomBytes, randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createStripeWebhookVerifier } from "@/integrations/stripe/webhooks";
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

import type { OnPaymentRequiresAction } from "./after-charge";
import { applyChargeResult } from "./apply-charge";
import { chargeBooking } from "./charge-booking";
import { processStripeWebhookEvent, receiveStripeWebhook } from "./process-webhook";
import { createPaymentIntentWebhookHandlers } from "./webhook-handlers";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Stripe is an in-memory fake; events are built locally (and signed locally for the route path).

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: () => log }));

let stripe = fakePaymentIntents();
const onPaymentRequiresAction = vi.fn<OnPaymentRequiresAction>();
const handlers = () =>
  createPaymentIntentWebhookHandlers({ gateway: () => stripe.gateway, onPaymentRequiresAction });
const chargeDeps = () => ({ gateway: () => stripe.gateway, onPaymentRequiresAction });

type OutcomeEvent =
  | "payment_intent.succeeded"
  | "payment_intent.payment_failed"
  | "payment_intent.requires_action"
  | "payment_intent.canceled";

/** A verified event as Stripe would send it; `data.object` is a stale snapshot on purpose. */
function event(type: OutcomeEvent, paymentIntentId: string): Stripe.Event {
  return {
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    livemode: false,
    created: 1_790_000_000,
    data: { object: { id: paymentIntentId, object: "payment_intent", status: "stale" } },
  } as unknown as Stripe.Event;
}

const deliver = (received: Stripe.Event) =>
  processStripeWebhookEvent(received, { handlers: handlers() });

/** Makes the synchronous charge fail technically after Stripe created the PaymentIntent. */
async function chargeLostAfterCreation(
  fixture: ChargeFixture,
  status: string,
  errorCode: string | null,
) {
  stripe.confirmWith({ status, errorCode });
  stripe.beforeAnswer(async () => {
    throw new Stripe.errors.StripeConnectionError({ type: "api_error", message: "lost" });
  });
  await expect(chargeBooking(fixture.bookingId, chargeDeps())).resolves.toMatchObject({
    outcome: "technical_error",
  });
  stripe.beforeAnswer(null);
  const [intent] = [...stripe.intents.values()];
  if (!intent) throw new Error("no PaymentIntent created");
  return intent;
}

describe("PaymentIntent webhooks (integration)", () => {
  beforeEach(async () => {
    stripe = fakePaymentIntents();
    onPaymentRequiresAction.mockReset();
    onPaymentRequiresAction.mockResolvedValue(undefined);
    vi.clearAllMocks();
    await resetChargeData();
  });

  afterAll(async () => {
    await resetChargeData();
    await db().$disconnect();
  });

  it("confirms the booking from the webhook alone, matching by metadata", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "succeeded", null);
    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "PENDING",
      attempt: 1,
      stripePaymentIntentId: null,
    });

    await expect(deliver(event("payment_intent.succeeded", intent.id))).resolves.toEqual({
      outcome: "processed",
      handled: true,
    });

    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({ status: "PAID", stripePaymentIntentId: intent.id });
    expect(booking.status).toBe("CONFIRMED");
    expect((await auditActions(fixture.bookingId)).map((row) => row.action)).toEqual([
      "booking.confirm",
    ]);
  });

  it("applies a success once when the webhook arrives before the synchronous answer", async () => {
    const fixture = await bookingWithPayment();
    stripe.beforeAnswer(async (intent) => {
      await deliver(event("payment_intent.succeeded", intent.id));
    });

    await expect(chargeBooking(fixture.bookingId, chargeDeps())).resolves.toMatchObject({
      outcome: "unchanged",
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    });

    const { booking, payment } = await chargeState(fixture);
    expect(payment.status).toBe("PAID");
    expect(booking).toMatchObject({ status: "CONFIRMED", version: 3 });
    expect((await auditActions(fixture.paymentId)).map((row) => row.action)).toEqual([
      "payment.charge_attempt",
      "payment.charge",
    ]);
    expect((await auditActions(fixture.bookingId)).map((row) => row.action)).toEqual([
      "booking.confirm",
    ]);
  });

  it("ignores a replayed event and a later event for an outcome already applied", async () => {
    const fixture = await bookingWithPayment();
    await chargeBooking(fixture.bookingId, chargeDeps());
    const intentId = (await chargeState(fixture)).payment.stripePaymentIntentId ?? "";

    const first = event("payment_intent.succeeded", intentId);
    await expect(deliver(first)).resolves.toEqual({ outcome: "processed", handled: true });
    await expect(deliver(first)).resolves.toEqual({ outcome: "duplicate", handled: false });
    const later = event("payment_intent.succeeded", intentId);
    await expect(deliver(later)).resolves.toEqual({ outcome: "processed", handled: true });

    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({ status: "PAID", version: 3 });
    expect(booking).toMatchObject({ status: "CONFIRMED", version: 3 });
    expect(await db().auditLog.count()).toBe(3);
  });

  it("applies the current Stripe state, not the event: a late failure after success is a no-op", async () => {
    const fixture = await bookingWithPayment();
    await chargeBooking(fixture.bookingId, chargeDeps());
    const intentId = (await chargeState(fixture)).payment.stripePaymentIntentId ?? "";

    await expect(deliver(event("payment_intent.payment_failed", intentId))).resolves.toEqual({
      outcome: "processed",
      handled: true,
    });
    expect((await chargeState(fixture)).payment.status).toBe("PAID");
  });

  it("ignores a transition the Payment table does not list (PAID → FAILED), with 200", async () => {
    const fixture = await bookingWithPayment();
    await chargeBooking(fixture.bookingId, chargeDeps());
    const intentId = (await chargeState(fixture)).payment.stripePaymentIntentId ?? "";
    stripe.update(intentId, {
      status: "requires_payment_method",
      lastPaymentErrorCode: "card_declined",
    });

    await expect(deliver(event("payment_intent.payment_failed", intentId))).resolves.toMatchObject({
      outcome: "processed",
    });
    expect((await chargeState(fixture)).payment).toMatchObject({ status: "PAID", version: 3 });
  });

  it("moves to REQUIRES_ACTION on authentication_required and calls the port once after commit", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(
      fixture,
      "requires_payment_method",
      "authentication_required",
    );

    await deliver(event("payment_intent.payment_failed", intent.id));
    await deliver(event("payment_intent.payment_failed", intent.id));

    const { booking, payment } = await chargeState(fixture);
    expect(payment.status).toBe("REQUIRES_ACTION");
    expect(booking.status).toBe("ACCEPTED");
    expect(onPaymentRequiresAction).toHaveBeenCalledExactlyOnceWith(fixture.paymentId);
  });

  it("answers 200 and keeps the state when the post-commit port fails", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(
      fixture,
      "requires_payment_method",
      "authentication_required",
    );
    onPaymentRequiresAction.mockRejectedValue(new Error("email down"));

    await expect(deliver(event("payment_intent.payment_failed", intent.id))).resolves.toEqual({
      outcome: "processed",
      handled: true,
    });
    expect((await chargeState(fixture)).payment.status).toBe("REQUIRES_ACTION");
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
      expect.stringContaining("onPaymentRequiresAction failed"),
    );
  });

  it("reads a soft decline (decline code authentication_required) as REQUIRES_ACTION", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({
      status: "requires_payment_method",
      errorCode: "card_declined",
      declineCode: "authentication_required",
    });
    stripe.beforeAnswer(async () => {
      throw new Stripe.errors.StripeConnectionError({ type: "api_error", message: "lost" });
    });
    await chargeBooking(fixture.bookingId, chargeDeps());
    stripe.beforeAnswer(null);
    const [intent] = [...stripe.intents.values()];
    if (!intent) throw new Error("no PaymentIntent created");

    await deliver(event("payment_intent.payment_failed", intent.id));

    expect((await chargeState(fixture)).payment.status).toBe("REQUIRES_ACTION");
    expect(onPaymentRequiresAction).toHaveBeenCalledExactlyOnceWith(fixture.paymentId);
  });

  it("re-checks the attempt under the lock before binding a PaymentIntent", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "succeeded", null);
    // A retry (VTC-041) moved to attempt 2 after the match, before the lock.
    await db().payment.update({ where: { id: fixture.paymentId }, data: { attempt: 2 } });

    const applied = await db().$transaction((tx) =>
      applyChargeResult(tx, {
        paymentId: fixture.paymentId,
        intent,
        errorCode: null,
        declineCode: null,
      }),
    );

    expect(applied).toEqual({
      outcome: "ignored",
      bookingRef: fixture.reference,
      reason: "attempt_mismatch",
    });
    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "PENDING",
      attempt: 2,
      stripePaymentIntentId: null,
    });
    expect((await chargeState(fixture)).booking.status).toBe("ACCEPTED");
  });

  it("records a success on a booking no longer ACCEPTED without touching it, with an alert", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "succeeded", null);
    // Cancelled meanwhile (set directly: the cancellation service is a later ticket).
    await db().booking.update({
      where: { id: fixture.bookingId },
      data: { status: "CANCELLED", version: { increment: 1 } },
    });

    await expect(deliver(event("payment_intent.succeeded", intent.id))).resolves.toEqual({
      outcome: "processed",
      handled: true,
    });

    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({ status: "PAID", stripePaymentIntentId: intent.id });
    expect(booking).toMatchObject({ status: "CANCELLED", version: 3 });
    expect(await auditActions(fixture.bookingId)).toEqual([]);
    expect(log.error).toHaveBeenCalledWith(
      { bookingRef: fixture.reference, bookingStatus: "CANCELLED" },
      "payment succeeded for a booking that is no longer ACCEPTED",
    );
  });

  it("records a declined card as FAILED from the webhook", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(
      fixture,
      "requires_payment_method",
      "card_declined",
    );

    await deliver(event("payment_intent.payment_failed", intent.id));

    expect((await chargeState(fixture)).payment.status).toBe("FAILED");
    expect((await chargeState(fixture)).booking.status).toBe("ACCEPTED");
  });

  it("settles a processing payment when Stripe reports success", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "processing", errorCode: null });
    await chargeBooking(fixture.bookingId, chargeDeps());
    const intentId = (await chargeState(fixture)).payment.stripePaymentIntentId ?? "";
    stripe.update(intentId, { status: "succeeded" });

    await deliver(event("payment_intent.succeeded", intentId));

    expect((await chargeState(fixture)).booking.status).toBe("CONFIRMED");
  });

  it("records a canceled PaymentIntent event without effect", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "canceled", null);

    await expect(deliver(event("payment_intent.canceled", intent.id))).resolves.toEqual({
      outcome: "processed",
      handled: false,
    });
    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "PENDING",
      stripePaymentIntentId: null,
    });
    expect(stripe.gateway.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it("ignores a PaymentIntent unknown to Stripe or to the application, with 200", async () => {
    const fixture = await bookingWithPayment();
    await expect(
      deliver(event("payment_intent.succeeded", "pi_UnknownToStripe1")),
    ).resolves.toEqual({ outcome: "processed", handled: true });
    stripe.put({
      id: "pi_FromElsewhere1",
      status: "succeeded",
      amountCents: 1_000,
      currency: "EUR",
      livemode: false,
      customerId: "cus_Elsewhere1",
      bookingRef: null,
      attempt: null,
      lastPaymentErrorCode: null,
      lastPaymentErrorDeclineCode: null,
    });
    await expect(deliver(event("payment_intent.succeeded", "pi_FromElsewhere1"))).resolves.toEqual({
      outcome: "processed",
      handled: true,
    });
    expect((await chargeState(fixture)).payment).toMatchObject({ status: "PENDING", attempt: 0 });
  });

  it("ignores a PaymentIntent whose Customer is not the booking's", async () => {
    const fixture = await bookingWithPayment();
    await chargeLostAfterCreation(fixture, "succeeded", null);
    stripe.put({
      id: "pi_OtherCustomer1",
      status: "succeeded",
      amountCents: TEST_TOTAL,
      currency: "EUR",
      livemode: false,
      customerId: "cus_SomeoneElse1",
      bookingRef: fixture.reference,
      attempt: 1,
      lastPaymentErrorCode: null,
      lastPaymentErrorDeclineCode: null,
    });

    await deliver(event("payment_intent.succeeded", "pi_OtherCustomer1"));

    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "PENDING",
      stripePaymentIntentId: null,
    });
  });

  it("ignores a PaymentIntent of a previous attempt and flags a success on it", async () => {
    const fixture = await bookingWithPayment();
    await chargeBooking(fixture.bookingId, chargeDeps());
    // Stands in for the manual retry (VTC-041): attempt 2 with its own PaymentIntent.
    await db().payment.update({
      where: { id: fixture.paymentId },
      data: { status: "FAILED", attempt: 2, stripePaymentIntentId: "pi_SecondAttempt1" },
    });
    const [first] = [...stripe.intents.values()];
    if (!first) throw new Error("no PaymentIntent created");

    await expect(deliver(event("payment_intent.succeeded", first.id))).resolves.toMatchObject({
      outcome: "processed",
    });

    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "FAILED",
      attempt: 2,
      stripePaymentIntentId: "pi_SecondAttempt1",
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRef: fixture.reference,
        alert: "orphan_succeeded_payment_intent",
      }),
      expect.any(String),
    );
  });

  it("answers an error without recording the event when Stripe cannot be read", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "succeeded", null);
    vi.mocked(stripe.gateway.retrievePaymentIntent).mockRejectedValueOnce(
      new Stripe.errors.StripeAPIError({ type: "api_error" }),
    );
    const received = event("payment_intent.succeeded", intent.id);

    await expect(deliver(received)).rejects.toBeInstanceOf(Stripe.errors.StripeAPIError);
    expect(await db().processedWebhookEvent.count({ where: { eventId: received.id } })).toBe(0);

    await expect(deliver(received)).resolves.toMatchObject({ outcome: "processed" });
    expect((await chargeState(fixture)).booking.status).toBe("CONFIRMED");
  });

  it("processes a locally signed event end to end through receiveStripeWebhook", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "succeeded", null);
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const body = JSON.stringify(event("payment_intent.succeeded", intent.id));
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });

    const received = await receiveStripeWebhook(body, signature, {
      verifier: createStripeWebhookVerifier({ secret: () => secret }),
      handlers: handlers(),
    });

    expect(received).toMatchObject({ outcome: "processed", handled: true });
    expect((await chargeState(fixture)).booking.status).toBe("CONFIRMED");
  });

  it("never logs a Stripe id", async () => {
    const fixture = await bookingWithPayment();
    const intent = await chargeLostAfterCreation(fixture, "succeeded", null);
    await deliver(event("payment_intent.succeeded", intent.id));

    const logged = JSON.stringify([
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(logged).not.toMatch(/pi_|cus_|pm_|seti_/);
  });
});
