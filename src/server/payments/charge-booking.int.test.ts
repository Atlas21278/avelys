import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { StripeConfigError } from "@/integrations/stripe";
import { acceptBooking } from "@/server/booking/decide-booking";
import { db } from "@/server/db";
import {
  auditActions,
  bookingWithPayment,
  chargeState,
  fakePaymentIntents,
  resetChargeData,
  TEST_TOTAL,
} from "@/test/charge-fixtures";

import type { OnPaymentRequiresAction } from "./after-charge";
import { chargeBooking } from "./charge-booking";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Stripe is an in-memory fake (no network, no key): see src/test/charge-fixtures.ts.

let stripe = fakePaymentIntents();
const onPaymentRequiresAction = vi.fn<OnPaymentRequiresAction>();
const deps = () => ({ gateway: () => stripe.gateway, onPaymentRequiresAction });

describe("chargeBooking (integration)", () => {
  beforeEach(async () => {
    stripe = fakePaymentIntents();
    onPaymentRequiresAction.mockReset();
    onPaymentRequiresAction.mockResolvedValue(undefined);
    await resetChargeData();
  });

  afterAll(async () => {
    await resetChargeData();
    await db().$disconnect();
  });

  it("charges the frozen amount off-session and confirms the booking on success", async () => {
    const fixture = await bookingWithPayment();

    const outcome = await chargeBooking(fixture.bookingId, deps());

    expect(outcome).toEqual({
      outcome: "applied",
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    });
    expect(stripe.createOffSessionCharge).toHaveBeenCalledOnce();
    expect(stripe.createOffSessionCharge).toHaveBeenCalledWith({
      customerId: fixture.customerId,
      paymentMethodId: expect.stringMatching(/^pm_/) as unknown,
      amountCents: TEST_TOTAL,
      currency: "EUR",
      bookingRef: fixture.reference,
      attempt: 1,
      idempotencyKey: `booking:${fixture.bookingId}:charge:1`,
    });

    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({ status: "PAID", attempt: 1, version: 3 });
    expect(payment.stripePaymentIntentId).toMatch(/^pi_/);
    expect(booking).toEqual({
      status: "CONFIRMED",
      version: 3,
      currentPaymentId: fixture.paymentId,
    });

    const paymentAudit = await auditActions(fixture.paymentId);
    expect(paymentAudit.map((row) => row.action)).toEqual([
      "payment.charge_attempt",
      "payment.charge",
    ]);
    expect(paymentAudit[1]).toMatchObject({
      actorType: "SYSTEM",
      before: { status: "PENDING", attempt: 1, version: 2 },
      after: {
        status: "PAID",
        attempt: 1,
        version: 3,
        paymentIntentId: payment.stripePaymentIntentId,
      },
    });
    const bookingAudit = await auditActions(fixture.bookingId);
    expect(bookingAudit).toEqual([
      {
        action: "booking.confirm",
        actorType: "SYSTEM",
        before: { bookingRef: fixture.reference, status: "ACCEPTED", version: 2 },
        after: { bookingRef: fixture.reference, status: "CONFIRMED", version: 3 },
      },
    ]);
    expect(onPaymentRequiresAction).not.toHaveBeenCalled();
  });

  it("moves the payment to REQUIRES_ACTION on authentication_required and calls the port once", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });

    const outcome = await chargeBooking(fixture.bookingId, deps());

    expect(outcome).toMatchObject({ paymentStatus: "REQUIRES_ACTION", bookingStatus: "ACCEPTED" });
    const { booking, payment } = await chargeState(fixture);
    expect(payment.status).toBe("REQUIRES_ACTION");
    expect(booking.status).toBe("ACCEPTED");
    expect(onPaymentRequiresAction).toHaveBeenCalledExactlyOnceWith(fixture.paymentId);
  });

  it("keeps REQUIRES_ACTION when the post-commit port fails", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });
    onPaymentRequiresAction.mockRejectedValue(new Error("email down"));

    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toMatchObject({
      paymentStatus: "REQUIRES_ACTION",
    });
    expect((await chargeState(fixture)).payment.status).toBe("REQUIRES_ACTION");
  });

  it.each(["card_declined", "expired_card", "insufficient_funds"])(
    "moves the payment to FAILED on %s and keeps the booking ACCEPTED",
    async (errorCode) => {
      const fixture = await bookingWithPayment();
      stripe.confirmWith({ status: "requires_payment_method", errorCode });

      await chargeBooking(fixture.bookingId, deps());

      const { booking, payment } = await chargeState(fixture);
      expect(payment).toMatchObject({ status: "FAILED", attempt: 1 });
      expect(booking.status).toBe("ACCEPTED");
      expect(onPaymentRequiresAction).not.toHaveBeenCalled();
    },
  );

  it("keeps the payment PENDING with its PaymentIntent while Stripe is processing", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "processing", errorCode: null });

    await chargeBooking(fixture.bookingId, deps());

    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({ status: "PENDING", attempt: 1 });
    expect(payment.stripePaymentIntentId).toMatch(/^pi_/);
    expect(booking.status).toBe("ACCEPTED");
  });

  it.each([
    ["a Stripe API error", new Stripe.errors.StripeAPIError({ type: "api_error" })],
    [
      "a network error",
      new Stripe.errors.StripeConnectionError({ type: "api_error", message: "timeout" }),
    ],
    ["a missing or live key", new StripeConfigError("live_key")],
  ])("changes no state on %s (PENDING, attempt 1, booking ACCEPTED)", async (_label, error) => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ throws: error });

    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toEqual({
      outcome: "technical_error",
      errorName: error.name,
    });

    const { booking, payment } = await chargeState(fixture);
    expect(payment).toEqual({
      status: "PENDING",
      attempt: 1,
      version: 2,
      stripePaymentIntentId: null,
    });
    expect(booking.status).toBe("ACCEPTED");
  });

  it("never charges twice: a second call is a no-op", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "card_declined" });

    await chargeBooking(fixture.bookingId, deps());
    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toEqual({
      outcome: "skipped",
      reason: "payment_not_pending",
    });
    expect(stripe.createOffSessionCharge).toHaveBeenCalledOnce();
  });

  it("does not retry after a technical failure (manual retry, DEC-27)", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ throws: new Stripe.errors.StripeAPIError({ type: "api_error" }) });

    await chargeBooking(fixture.bookingId, deps());
    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toEqual({
      outcome: "skipped",
      reason: "attempt_already_made",
    });
    expect(stripe.createOffSessionCharge).toHaveBeenCalledOnce();
  });

  it("makes a single attempt under concurrent calls", async () => {
    const fixture = await bookingWithPayment();

    const outcomes = await Promise.all(
      [1, 2, 3].map(() => chargeBooking(fixture.bookingId, deps())),
    );

    expect(stripe.createOffSessionCharge).toHaveBeenCalledOnce();
    expect(outcomes.filter((outcome) => outcome.outcome === "applied")).toHaveLength(1);
    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({ status: "PAID", attempt: 1 });
    expect(booking.status).toBe("CONFIRMED");
    const actions = (await auditActions(fixture.paymentId)).map((row) => row.action);
    expect(actions).toEqual(["payment.charge_attempt", "payment.charge"]);
  });

  it("applies an existing succeeded PaymentIntent instead of charging again", async () => {
    const fixture = await bookingWithPayment();
    stripe.put({
      id: "pi_AlreadySucceeded1",
      status: "succeeded",
      amountCents: TEST_TOTAL,
      currency: "EUR",
      livemode: false,
      customerId: fixture.customerId,
      bookingRef: fixture.reference,
      attempt: 1,
      lastPaymentErrorCode: null,
    });

    await chargeBooking(fixture.bookingId, deps());

    expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
    const { booking, payment } = await chargeState(fixture);
    expect(payment).toMatchObject({
      status: "PAID",
      stripePaymentIntentId: "pi_AlreadySucceeded1",
    });
    expect(booking.status).toBe("CONFIRMED");
  });

  it.each([
    ["REQUESTED", "booking_not_accepted"],
    ["REFUSED", "booking_not_accepted"],
    ["CONFIRMED", "booking_not_accepted"],
  ] as const)("does nothing for a %s booking", async (status, reason) => {
    const fixture = await bookingWithPayment({ status });
    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toEqual({
      outcome: "skipped",
      reason,
    });
    expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
    expect((await chargeState(fixture)).payment.attempt).toBe(0);
  });

  it("does nothing for an unknown booking or a booking without payment", async () => {
    await expect(chargeBooking("no-such-booking", deps())).resolves.toEqual({
      outcome: "skipped",
      reason: "booking_not_found",
    });
    const fixture = await bookingWithPayment({ link: false });
    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toEqual({
      outcome: "skipped",
      reason: "no_payment",
    });
    expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
  });

  it("refuses to charge when the payment amount differs from the booking", async () => {
    const fixture = await bookingWithPayment({ paymentAmountCents: TEST_TOTAL + 1 });

    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toEqual({
      outcome: "refused",
      code: "PAYMENT_AMOUNT_MISMATCH",
      reason: "payment_vs_booking",
    });
    expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
    expect((await chargeState(fixture)).payment).toMatchObject({ status: "PENDING", attempt: 0 });
  });

  it("refuses to charge when the booking total differs from its snapshot", async () => {
    const fixture = await bookingWithPayment({ paymentAmountCents: TEST_TOTAL + 1 });
    await db().booking.update({
      where: { id: fixture.bookingId },
      data: { totalTtcCents: TEST_TOTAL + 1 },
    });

    await expect(chargeBooking(fixture.bookingId, deps())).resolves.toMatchObject({
      outcome: "refused",
      code: "PAYMENT_AMOUNT_MISMATCH",
      reason: "snapshot_vs_booking",
    });
    expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
  });

  it("refuses to charge a current Payment that belongs to another booking", async () => {
    const owner = await bookingWithPayment({ link: false });
    const other = await bookingWithPayment({ link: false });
    // Only the code guarantees the pointer's ownership (review of avelys#27): break it on purpose.
    await db().booking.update({
      where: { id: other.bookingId },
      data: { currentPaymentId: owner.paymentId },
    });

    await expect(chargeBooking(other.bookingId, deps())).resolves.toEqual({
      outcome: "refused",
      code: "PAYMENT_STATE_INCONSISTENT",
      reason: "payment_of_other_booking",
    });
    expect(stripe.createOffSessionCharge).not.toHaveBeenCalled();
    expect(stripe.gateway.listCustomerPaymentIntents).not.toHaveBeenCalled();
  });

  it("charges once the acceptance has committed, through the onBookingAccepted port", async () => {
    const fixture = await bookingWithPayment({ status: "REQUESTED" });
    const port = vi.fn(async (bookingId: string) => {
      // The acceptance is already committed when the port runs.
      expect((await chargeState(fixture)).booking.status).toBe("ACCEPTED");
      await chargeBooking(bookingId, deps());
    });

    const accepted = await acceptBooking(
      fixture.reference,
      2,
      { role: "ADMIN", userId: "admin-user-id" },
      { onBookingAccepted: port },
    );

    expect(accepted.status).toBe("ACCEPTED");
    expect(port).toHaveBeenCalledExactlyOnceWith(fixture.bookingId);
    const { booking, payment } = await chargeState(fixture);
    expect(payment.status).toBe("PAID");
    expect(booking).toMatchObject({ status: "CONFIRMED", version: 4 });
    expect((await auditActions(fixture.bookingId)).map((row) => row.action)).toEqual([
      "booking.accept",
      "booking.confirm",
    ]);
  });

  it("keeps the current Payment pointer unchanged", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "card_declined" });
    await chargeBooking(fixture.bookingId, deps());
    expect((await chargeState(fixture)).booking.currentPaymentId).toBe(fixture.paymentId);
    expect(await db().payment.count({ where: { bookingId: fixture.bookingId } })).toBe(1);
  });
});
