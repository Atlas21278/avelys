import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Test-only value built at run time, set before the environment is first read: not a secret.
const LINK_KEY = ["integration", "tests", "only", "payment-link-key-vtc044"].join("-");
process.env.PAYMENT_LINK_SECRET = LINK_KEY;

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const { verifyRegularizationToken } = await import("@/domain/payment/regularization-token");
const { db } = await import("@/server/db");
const { latestPaymentActionEmail } = await import("@/server/admin/bookings");
const { bookingWithPayment, chargeState, fakePaymentIntents, resetChargeData } =
  await import("@/test/charge-fixtures");
const { sendPaymentActionRequiredEmail } = await import("./action-required-email");
const { chargeBooking } = await import("./charge-booking");
const { processStripeWebhookEvent } = await import("./process-webhook");
const { createPaymentIntentWebhookHandlers } = await import("./webhook-handlers");

import type { PrismaClient } from "@/generated/prisma/client";
import type { EmailMessage, EmailSendResult } from "@/integrations/email/sender";
import type { ChargeFixture } from "@/test/charge-fixtures";

import type { PaymentActionEmailDeps } from "./action-required-email";

// Runs against the real test database (vitest "integration" project), migrations applied.
// Stripe and the email provider are in-memory fakes: no network call, no real email.

const BEFORE_PICKUP = new Date("2026-10-30T10:00:00Z");
const AFTER_PICKUP = new Date("2026-11-02T09:00:01Z");

let stripe = fakePaymentIntents();
const sent: EmailMessage[] = [];
const send = vi.fn(async (message: EmailMessage): Promise<EmailSendResult> => {
  sent.push(message);
  return { ok: true, messageId: `msg_${sent.length}` };
});
const emailDeps = (extra: PaymentActionEmailDeps = {}): PaymentActionEmailDeps => ({
  sender: { send },
  now: () => BEFORE_PICKUP,
  ...extra,
});

// The port as production wires it, with the fakes.
const port = async (paymentId: string) => {
  await sendPaymentActionRequiredEmail(paymentId, emailDeps());
};
const handlers = () =>
  createPaymentIntentWebhookHandlers({
    gateway: () => stripe.gateway,
    onPaymentRequiresAction: port,
  });
const chargeDeps = () => ({ gateway: () => stripe.gateway, onPaymentRequiresAction: port });

type OutcomeEvent = "payment_intent.payment_failed" | "payment_intent.requires_action";

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

/** The synchronous charge is lost after Stripe asked for authentication: only the webhook knows. */
async function requiresActionByWebhookOnly(fixture: ChargeFixture) {
  stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });
  stripe.beforeAnswer(async () => {
    throw new Stripe.errors.StripeConnectionError({ type: "api_error", message: "lost" });
  });
  await chargeBooking(fixture.bookingId, chargeDeps());
  stripe.beforeAnswer(null);
  const [intent] = [...stripe.intents.values()];
  if (!intent) throw new Error("no PaymentIntent created");
  expect(send).not.toHaveBeenCalled();
  return intent;
}

async function rows(fixture: ChargeFixture) {
  const client = db();
  const [booking, payment] = await Promise.all([
    client.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } }),
    client.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } }),
  ]);
  return { booking, payment };
}

function notifications(fixture: ChargeFixture) {
  return db().notification.findMany({
    where: { bookingId: fixture.bookingId },
    orderBy: { createdAt: "asc" },
  });
}

async function customerEmail(fixture: ChargeFixture) {
  const booking = await db().booking.findUniqueOrThrow({
    where: { id: fixture.bookingId },
    select: { customer: { select: { email: true } } },
  });
  return booking.customer.email;
}

/** Token of the regularisation link in a sent email. */
function linkIn(message: EmailMessage, prefix: string): string {
  const match = new RegExp(`${prefix.replaceAll("/", "\\/")}([A-Za-z0-9_-]+)`).exec(message.text);
  if (!match?.[1]) throw new Error("no regularisation link in the email");
  return match[1];
}

/** Everything that was logged, serialised. */
const logged = () =>
  JSON.stringify([
    log.info.mock.calls,
    log.warn.mock.calls,
    log.error.mock.calls,
    log.debug.mock.calls,
  ]);

describe("payment authentication email (integration)", () => {
  beforeEach(async () => {
    stripe = fakePaymentIntents();
    sent.length = 0;
    vi.clearAllMocks();
    await resetChargeData();
  });

  afterAll(async () => {
    await resetChargeData();
    await db().$disconnect();
  });

  it("sends one email with a valid link when the webhook moves the Payment to REQUIRES_ACTION, none on replay", async () => {
    const fixture = await bookingWithPayment();
    const intent = await requiresActionByWebhookOnly(fixture);

    const first = event("payment_intent.payment_failed", intent.id);
    await deliver(first);
    await deliver(first); // same event replayed: already recorded
    await deliver(event("payment_intent.payment_failed", intent.id)); // another delivery
    await deliver(event("payment_intent.requires_action", intent.id));

    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "REQUIRES_ACTION",
      attempt: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [message] = sent;
    if (!message) throw new Error("no email");
    expect(message.to).toBe(await customerEmail(fixture));
    expect(message.subject).toBe(
      `Authentification requise pour le paiement de votre course ${fixture.reference}`,
    );
    expect(message.text).toContain(fixture.reference);
    expect(message.text).toContain("http://localhost:3000/contact");
    const token = linkIn(message, "http://localhost:3000/paiement/");
    expect(verifyRegularizationToken(token, LINK_KEY)).toEqual({
      paymentId: fixture.paymentId,
      attempt: 1,
    });

    expect(await notifications(fixture)).toEqual([
      expect.objectContaining({
        kind: "PAYMENT_ACTION_REQUIRED",
        locale: "fr",
        dedupeKey: `payment-action-required:${fixture.paymentId}:1`,
        status: "SENT",
        attempts: 1,
      }),
    ]);
    expect(await latestPaymentActionEmail(fixture.bookingId, fixture.paymentId)).toMatchObject({
      status: "SENT",
      attempt: 1,
      lastErrorCode: null,
    });
  });

  it("sends from the synchronous charge path too", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });

    await chargeBooking(fixture.bookingId, chargeDeps());

    expect((await chargeState(fixture)).payment.status).toBe("REQUIRES_ACTION");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing more when the same attempt goes FAILED → REQUIRES_ACTION again", async () => {
    const fixture = await bookingWithPayment();
    const intent = await requiresActionByWebhookOnly(fixture);
    await deliver(event("payment_intent.payment_failed", intent.id));
    expect(send).toHaveBeenCalledTimes(1);

    // The customer fails 3-D Secure in the page, then tries again from it.
    stripe.update(intent.id, { lastPaymentErrorCode: "payment_intent_authentication_failure" });
    await deliver(event("payment_intent.payment_failed", intent.id));
    expect((await chargeState(fixture)).payment.status).toBe("FAILED");
    stripe.update(intent.id, { status: "requires_action", lastPaymentErrorCode: null });
    await deliver(event("payment_intent.requires_action", intent.id));

    expect((await chargeState(fixture)).payment).toMatchObject({
      status: "REQUIRES_ACTION",
      attempt: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await notifications(fixture)).toHaveLength(1);
  });

  it("sends a new link for a new attempt (manual retry)", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });
    await chargeBooking(fixture.bookingId, chargeDeps());
    // As a retry (VTC-041) leaves it: next attempt, authentication asked again.
    await db().payment.update({ where: { id: fixture.paymentId }, data: { attempt: 2 } });

    await sendPaymentActionRequiredEmail(fixture.paymentId, emailDeps());
    await sendPaymentActionRequiredEmail(fixture.paymentId, emailDeps());

    expect(send).toHaveBeenCalledTimes(2);
    const second = sent[1];
    if (!second) throw new Error("no second email");
    const token = linkIn(second, "http://localhost:3000/paiement/");
    expect(verifyRegularizationToken(token, LINK_KEY)).toEqual({
      paymentId: fixture.paymentId,
      attempt: 2,
    });
    expect((await notifications(fixture)).map((row) => row.dedupeKey)).toEqual([
      `payment-action-required:${fixture.paymentId}:1`,
      `payment-action-required:${fixture.paymentId}:2`,
    ]);
    expect(await latestPaymentActionEmail(fixture.bookingId, fixture.paymentId)).toMatchObject({
      status: "SENT",
      attempt: 2,
    });
  });

  it("writes in the language of the booking contact", async () => {
    const fixture = await bookingWithPayment();
    await db().booking.update({
      where: { id: fixture.bookingId },
      data: { contactName: "Guest Test", contactLocale: "en" },
    });
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });

    await chargeBooking(fixture.bookingId, chargeDeps());

    const [message] = sent;
    if (!message) throw new Error("no email");
    expect(message.subject).toBe(
      `Authentication required to pay for your ride ${fixture.reference}`,
    );
    expect(message.text).toContain("http://localhost:3000/en/contact");
    linkIn(message, "http://localhost:3000/en/payment/");
    expect((await notifications(fixture))[0]?.locale).toBe("en");
  });

  it("records a FAILED notification and changes neither Booking nor Payment when the send fails", async () => {
    const fixture = await bookingWithPayment();
    const intent = await requiresActionByWebhookOnly(fixture);
    send.mockResolvedValueOnce({ ok: false, code: "EMAIL_PROVIDER_ERROR" });

    await expect(deliver(event("payment_intent.payment_failed", intent.id))).resolves.toEqual({
      outcome: "processed",
      handled: true,
    });
    const before = await rows(fixture);
    expect(before.payment.status).toBe("REQUIRES_ACTION");
    expect(before.booking.status).toBe("ACCEPTED");

    // A later call for the same attempt is the retry of the email; it changes nothing either.
    send.mockResolvedValueOnce({ ok: false, code: "EMAIL_TIMEOUT" });
    await expect(
      sendPaymentActionRequiredEmail(fixture.paymentId, emailDeps()),
    ).resolves.toMatchObject({ outcome: "failed", code: "EMAIL_TIMEOUT" });

    expect(await rows(fixture)).toEqual(before);
    expect(await latestPaymentActionEmail(fixture.bookingId, fixture.paymentId)).toMatchObject({
      status: "FAILED",
      attempt: 1,
      lastErrorCode: "EMAIL_TIMEOUT",
      sentAt: null,
    });
  });

  it("never sends an email without a link (PAYMENT_LINK_SECRET missing)", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });
    await chargeBooking(fixture.bookingId, {
      gateway: () => stripe.gateway,
      onPaymentRequiresAction: async (paymentId: string) => {
        await sendPaymentActionRequiredEmail(
          paymentId,
          emailDeps({ regularizationUrl: () => null }),
        );
      },
    });
    const before = await rows(fixture);

    expect(send).not.toHaveBeenCalled();
    expect(await notifications(fixture)).toEqual([
      expect.objectContaining({ status: "FAILED", lastErrorCode: "EMAIL_RENDER_FAILED" }),
    ]);
    expect(before.payment.status).toBe("REQUIRES_ACTION");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "EMAIL_RENDER_FAILED",
        errorName: "PaymentLinkUnavailableError",
      }),
      "notification.failed",
    );
  });

  it("sends nothing when the link would already be unusable", async () => {
    const fixture = await bookingWithPayment();
    stripe.confirmWith({ status: "requires_payment_method", errorCode: "authentication_required" });
    await chargeBooking(fixture.bookingId, {
      gateway: () => stripe.gateway,
      onPaymentRequiresAction: async () => {},
    });

    // Pickup passed.
    await expect(
      sendPaymentActionRequiredEmail(fixture.paymentId, emailDeps({ now: () => AFTER_PICKUP })),
    ).resolves.toEqual({ outcome: "not_applicable", reason: "LINK_UNUSABLE" });
    // Paid in the meantime.
    await db().payment.update({ where: { id: fixture.paymentId }, data: { status: "PAID" } });
    await expect(sendPaymentActionRequiredEmail(fixture.paymentId, emailDeps())).resolves.toEqual({
      outcome: "not_applicable",
      reason: "LINK_UNUSABLE",
    });
    // Unknown Payment.
    await expect(sendPaymentActionRequiredEmail("unknown-payment", emailDeps())).resolves.toEqual({
      outcome: "not_applicable",
      reason: "PAYMENT_NOT_FOUND",
    });

    expect(send).not.toHaveBeenCalled();
    expect(await notifications(fixture)).toEqual([]);
    expect(await latestPaymentActionEmail(fixture.bookingId, fixture.paymentId)).toBeNull();
  });

  it("never throws, even when the database fails", async () => {
    const broken = {
      payment: {
        findUnique: async () => {
          throw new Error("connection lost to 127.0.0.1 for client-x@avelys.test");
        },
      },
    } as unknown as PrismaClient;

    await expect(
      sendPaymentActionRequiredEmail("any-payment", emailDeps({ db: broken })),
    ).resolves.toEqual({ outcome: "failed", code: "INTERNAL_ERROR" });
    expect(log.error).toHaveBeenCalledWith(
      { bookingRef: null, errorName: "Error" },
      "payment action email failed",
    );
    expect(logged()).not.toContain("avelys.test");
  });

  it("logs neither the link, the token nor the address", async () => {
    const fixture = await bookingWithPayment();
    const intent = await requiresActionByWebhookOnly(fixture);
    await deliver(event("payment_intent.payment_failed", intent.id));
    send.mockResolvedValueOnce({ ok: false, code: "EMAIL_REJECTED" });
    await db().payment.update({ where: { id: fixture.paymentId }, data: { attempt: 2 } });
    await sendPaymentActionRequiredEmail(fixture.paymentId, emailDeps());

    const [message] = sent;
    if (!message) throw new Error("no email");
    const token = linkIn(message, "http://localhost:3000/paiement/");
    const output = logged();
    expect(output).not.toContain(token);
    expect(output).not.toContain("/paiement/");
    expect(output).not.toContain(await customerEmail(fixture));
    expect(output).toContain(fixture.reference);
  });
});
