import { Text } from "@react-email/components";
import { createElement } from "react";
import type { CreateEmailResponse } from "resend";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailLayout } from "@/emails/layout";
import type { Locale } from "@/i18n/routing";
import { providerIdempotencyKey } from "@/integrations/email";
import { createResendEmailSender } from "@/integrations/email/resend";
import type { EmailMessage, EmailSender, EmailSendResult } from "@/integrations/email/sender";
import { generateReference } from "@/server/booking/reference";
import { db } from "@/server/db";

import { sendNotification, type SendNotificationInput } from "./send-notification";

// Runs against the real test database (vitest "integration" project), migrations applied.
// The email provider is always a fake: no network call.

const TEST_RULE = { id: "test-rule-notifications", version: 1 } as const;
const CUSTOMER_EMAIL = "notification-guest@avelys.test";
const SUBJECT_MARKER = "Sujet-de-test-unique";

let customerId = "";

async function reset() {
  const client = db();
  await client.notification.deleteMany();
  await client.auditLog.deleteMany();
  await client.payment.deleteMany();
  await client.booking.deleteMany();
  await client.customer.deleteMany();
  await client.pricingRule.deleteMany();
}

async function booking() {
  const pickupAt = new Date("2026-11-02T09:00:00Z");
  return db().booking.create({
    data: {
      reference: generateReference(),
      customerId,
      pickupLabel: "Gare de Lyon, Paris",
      pickupLat: 48.844_3,
      pickupLng: 2.374_3,
      dropoffLabel: "Aéroport Paris-Charles de Gaulle",
      dropoffLat: 49.009_7,
      dropoffLng: 2.547_9,
      pickupAt,
      pickupLocalDateTime: pickupAt,
      passengerCount: 1,
      luggageCount: 1,
      quotedDistanceMeters: 31_250,
      quotedDurationSeconds: 2_400,
      // Test values only, not a tariff.
      totalTtcCents: 12_345,
      currency: "EUR",
      pricingSnapshot: { schemaVersion: 1, note: "test snapshot" },
      pricingRuleId: TEST_RULE.id,
      pricingRuleVersion: TEST_RULE.version,
    },
  });
}

function input(
  bookingId: string,
  dedupeKey: string,
  overrides: Partial<SendNotificationInput> = {},
): SendNotificationInput {
  return {
    kind: "PAYMENT_ACTION_REQUIRED",
    bookingId,
    dedupeKey,
    locale: "fr",
    render: ({ bookingReference, locale }: { bookingReference: string; locale: Locale }) => ({
      subject: `${SUBJECT_MARKER} ${bookingReference}`,
      element: createElement(
        EmailLayout,
        { locale, preview: "Aperçu" },
        createElement(Text, null, "Corps du message de test."),
      ),
    }),
    ...overrides,
  };
}

/** Fake sender recording every message; answers with `result` after `delayMs`. */
function fakeSender(result: EmailSendResult = { ok: true, messageId: "msg_test_1" }, delayMs = 0) {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    send: vi.fn(async (message: EmailMessage) => {
      sent.push(message);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return result;
    }),
  };
  return { sender, sent };
}

function spyLog() {
  const calls: unknown[] = [];
  const record = (...args: unknown[]) => void calls.push(args);
  return { log: { info: record, warn: record, error: record }, calls };
}

const row = (dedupeKey: string) => db().notification.findUniqueOrThrow({ where: { dedupeKey } });

describe("sendNotification (integration)", () => {
  beforeAll(async () => {
    await reset();
    await db().pricingRule.create({
      data: {
        ...TEST_RULE,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        config: { note: "test rule, not a tariff" },
        schemaVersion: 1,
      },
    });
    const customer = await db().customer.create({
      data: { name: "Notification Guest", email: CUSTOMER_EMAIL },
    });
    customerId = customer.id;
  });

  beforeEach(async () => {
    await db().notification.deleteMany();
  });

  afterAll(async () => {
    await reset();
    await db().$disconnect();
  });

  it("sends once, records SENT with the provider id, then ignores the same key", async () => {
    const { id, reference } = await booking();
    const { sender, sent } = fakeSender();
    const { log, calls } = spyLog();

    const first = await sendNotification(input(id, `booking:${id}:test`), { sender, log });
    const second = await sendNotification(input(id, `booking:${id}:test`), { sender, log });

    expect(first).toMatchObject({ outcome: "sent", attempts: 1 });
    expect(second).toMatchObject({ outcome: "skipped", reason: "ALREADY_SENT" });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(sent[0]).toMatchObject({
      to: CUSTOMER_EMAIL,
      subject: `${SUBJECT_MARKER} ${reference}`,
      idempotencyKey: providerIdempotencyKey(`booking:${id}:test`),
    });
    expect(sent[0]?.html).toContain("Corps du message de test.");
    expect(sent[0]?.text).toContain("Corps du message de test.");

    const stored = await row(`booking:${id}:test`);
    expect(stored).toMatchObject({
      bookingId: id,
      kind: "PAYMENT_ACTION_REQUIRED",
      locale: "fr",
      status: "SENT",
      attempts: 1,
      providerMessageId: "msg_test_1",
      lastErrorCode: null,
    });
    expect(stored.sentAt).toBeInstanceOf(Date);

    // Neither the address nor the content reaches the database or the logs (BR-60).
    for (const trace of [JSON.stringify(stored), JSON.stringify(calls)]) {
      expect(trace).not.toContain(CUSTOMER_EMAIL);
      expect(trace).not.toContain(SUBJECT_MARKER);
      expect(trace).not.toContain("Corps du message");
    }
    expect(JSON.stringify(calls)).toContain(reference);
  });

  it("traces a provider failure as FAILED without touching the booking, then retries", async () => {
    const created = await booking();
    const before = await db().booking.findUniqueOrThrow({ where: { id: created.id } });
    const key = `booking:${created.id}:failure`;

    const failed = await sendNotification(input(created.id, key), {
      sender: fakeSender({ ok: false, code: "EMAIL_PROVIDER_ERROR" }).sender,
      log: spyLog().log,
    });
    expect(failed).toMatchObject({ outcome: "failed", code: "EMAIL_PROVIDER_ERROR" });
    expect(await row(key)).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastErrorCode: "EMAIL_PROVIDER_ERROR",
      providerMessageId: null,
      sentAt: null,
    });
    expect(await db().booking.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
    expect(await db().payment.count({ where: { bookingId: created.id } })).toBe(0);
    expect(await db().auditLog.count({ where: { entityId: created.id } })).toBe(0);

    const retried = await sendNotification(input(created.id, key), {
      sender: fakeSender({ ok: true, messageId: "msg_retry" }).sender,
      log: spyLog().log,
    });
    expect(retried).toMatchObject({ outcome: "sent", attempts: 2 });
    expect(await row(key)).toMatchObject({
      status: "SENT",
      attempts: 2,
      lastErrorCode: null,
      providerMessageId: "msg_retry",
    });
  });

  it("records a timeout of the Resend adapter as FAILED", async () => {
    const { id } = await booking();
    const sender = createResendEmailSender({
      apiKey: () => ["re", "integrationPlaceholder"].join("_"),
      from: () => "bookings@example.com",
      timeoutMs: 20,
      createClient: () => ({
        emails: { send: () => new Promise<CreateEmailResponse>(() => {}) },
      }),
    });

    const result = await sendNotification(input(id, `booking:${id}:timeout`), {
      sender,
      log: spyLog().log,
    });
    expect(result).toMatchObject({ outcome: "failed", code: "EMAIL_TIMEOUT" });
    expect(await row(`booking:${id}:timeout`)).toMatchObject({
      status: "FAILED",
      lastErrorCode: "EMAIL_TIMEOUT",
    });
  });

  it("fails as not configured with the default sender when no Resend key is set", async () => {
    const { id } = await booking();
    const result = await sendNotification(input(id, `booking:${id}:no-key`));
    expect(result).toMatchObject({ outcome: "failed", code: "EMAIL_NOT_CONFIGURED" });
    expect(await row(`booking:${id}:no-key`)).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastErrorCode: "EMAIL_NOT_CONFIGURED",
    });
  });

  it("sends only once when calls with the same key run concurrently", async () => {
    const { id } = await booking();
    const { sender } = fakeSender({ ok: true, messageId: "msg_once" }, 100);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendNotification(input(id, `booking:${id}:concurrent`), { sender, log: spyLog().log }),
      ),
    );

    expect(sender.send).toHaveBeenCalledOnce();
    expect(results.filter((result) => result.outcome === "sent")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "skipped")).toHaveLength(3);
    expect(await row(`booking:${id}:concurrent`)).toMatchObject({ status: "SENT", attempts: 1 });
  });

  it("leaves a recent PENDING attempt alone and takes over an expired one", async () => {
    const { id } = await booking();
    const key = `booking:${id}:pending`;
    const startedAt = new Date("2026-09-29T10:00:00.000Z");
    await db().notification.create({
      data: {
        bookingId: id,
        kind: "PAYMENT_ACTION_REQUIRED",
        locale: "fr",
        dedupeKey: key,
        attempts: 1,
        lastAttemptAt: startedAt,
      },
    });
    const { sender } = fakeSender();
    const at = (ms: number) => () => new Date(startedAt.getTime() + ms);

    const inFlight = await sendNotification(input(id, key), {
      sender,
      now: at(30_000),
      leaseMs: 60_000,
      log: spyLog().log,
    });
    expect(inFlight).toMatchObject({ outcome: "skipped", reason: "IN_PROGRESS" });
    expect(sender.send).not.toHaveBeenCalled();

    const takenOver = await sendNotification(input(id, key), {
      sender,
      now: at(61_000),
      leaseMs: 60_000,
      log: spyLog().log,
    });
    expect(takenOver).toMatchObject({ outcome: "sent", attempts: 2 });
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it("records a template failure without sending", async () => {
    const { id } = await booking();
    const { sender } = fakeSender();
    const result = await sendNotification(
      input(id, `booking:${id}:render`, {
        render: () => {
          throw new Error(`template failed for ${CUSTOMER_EMAIL}`);
        },
      }),
      { sender, log: spyLog().log },
    );
    expect(result).toMatchObject({ outcome: "failed", code: "EMAIL_RENDER_FAILED" });
    expect(sender.send).not.toHaveBeenCalled();
    expect(await row(`booking:${id}:render`)).toMatchObject({
      status: "FAILED",
      lastErrorCode: "EMAIL_RENDER_FAILED",
    });
  });

  it("refuses an unknown booking, an invalid input and a key reused for another booking", async () => {
    const { sender } = fakeSender();
    const deps = { sender, log: spyLog().log };

    expect(await sendNotification(input("unknown-booking", "key:unknown"), deps)).toEqual({
      outcome: "failed",
      code: "BOOKING_NOT_FOUND",
    });
    expect(await db().notification.count({ where: { dedupeKey: "key:unknown" } })).toBe(0);

    const { id } = await booking();
    expect(
      await sendNotification(input(id, "key:invalid", { locale: "de" as Locale }), deps),
    ).toEqual({ outcome: "failed", code: "INVALID_NOTIFICATION" });
    expect(await sendNotification(input(id, "   "), deps)).toEqual({
      outcome: "failed",
      code: "INVALID_NOTIFICATION",
    });

    const other = await booking();
    await sendNotification(input(id, "key:shared"), deps);
    expect(await sendNotification(input(other.id, "key:shared"), deps)).toMatchObject({
      outcome: "failed",
      code: "DEDUPE_KEY_CONFLICT",
    });
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it("never throws, even when the sender does", async () => {
    const { id } = await booking();
    const sender: EmailSender = {
      send: () => Promise.reject(new Error(`network down for ${CUSTOMER_EMAIL}`)),
    };
    const result = await sendNotification(input(id, `booking:${id}:throws`), {
      sender,
      log: spyLog().log,
    });
    expect(result).toMatchObject({ outcome: "failed", code: "EMAIL_PROVIDER_ERROR" });
  });
});
