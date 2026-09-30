import "server-only";

import type { ReactElement } from "react";
import { z } from "zod";

import { renderEmail } from "@/emails/render";
import { NotificationKind, type NotificationStatus } from "@/generated/prisma/client";
import { routing, type Locale } from "@/i18n/routing";
import { emailSender, providerIdempotencyKey, type EmailErrorCode } from "@/integrations/email";
import type { EmailSender } from "@/integrations/email/sender";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

/**
 * Transactional email service (VTC-043, ADR-0011). Called **after** the business transaction has
 * committed, never inside it: it has its own writes, on `Notification` only, and never touches
 * `Booking` or `Payment` (BR-50). It never throws: the outcome is returned and logged with the
 * booking reference, the kind and a technical code — never an address or a content (BR-60).
 *
 * One email per `dedupeKey`, ever:
 * - a `SENT` notification is not sent again;
 * - a `PENDING` one whose attempt started less than `leaseMs` ago is being sent by another call;
 * - otherwise (`FAILED`, or `PENDING` left by an interrupted attempt) a new attempt is claimed
 *   with a compare-and-set on `attempts`, so that concurrent calls send at most once. The
 *   provider idempotency key, derived from `dedupeKey`, covers the remaining window (an
 *   attempt that timed out but was accepted).
 *
 * No automatic retry here: calling again with the same key is the retry.
 */

/** Technical defaults, configurable per call. Not business values. */
export const NOTIFICATION_DEFAULTS = {
  /** Longer than the Resend timeout plus rendering: a younger PENDING attempt is in flight. */
  leaseMs: 60_000,
} as const;

export interface NotificationRenderContext {
  /** Public booking reference, for the subject or the body. */
  readonly bookingReference: string;
  readonly locale: Locale;
}

export interface RenderedNotification {
  readonly subject: string;
  /** Template wrapped in `EmailLayout`. */
  readonly element: ReactElement;
}

export interface SendNotificationInput {
  readonly kind: NotificationKind;
  readonly bookingId: string;
  /** One email per key, ever (e.g. `booking:{id}:payment-action-required:{paymentId}`). */
  readonly dedupeKey: string;
  readonly locale: Locale;
  readonly render: (
    context: NotificationRenderContext,
  ) => RenderedNotification | Promise<RenderedNotification>;
}

type NotificationLogger = Pick<ReturnType<typeof logger>, "info" | "warn" | "error">;

export interface SendNotificationDeps {
  readonly sender?: EmailSender;
  readonly now?: () => Date;
  readonly leaseMs?: number;
  readonly log?: NotificationLogger;
}

export type NotificationFailureCode =
  | EmailErrorCode
  /** The template threw while rendering. */
  | "EMAIL_RENDER_FAILED"
  /** Invalid kind, locale, booking id or deduplication key. */
  | "INVALID_NOTIFICATION"
  | "BOOKING_NOT_FOUND"
  /** The key already belongs to another booking or another kind. */
  | "DEDUPE_KEY_CONFLICT"
  /** Unexpected error (database unavailable, for instance). */
  | "INTERNAL_ERROR";

export type SendNotificationResult =
  | { readonly outcome: "sent"; readonly notificationId: string; readonly attempts: number }
  | {
      readonly outcome: "skipped";
      readonly reason: "ALREADY_SENT" | "IN_PROGRESS";
      readonly notificationId: string;
    }
  | {
      readonly outcome: "failed";
      readonly code: NotificationFailureCode;
      /** Absent when no notification row could be written (invalid input, unknown booking). */
      readonly notificationId?: string;
    };

const InputSchema = z.object({
  kind: z.enum(NotificationKind),
  bookingId: z.string().min(1).max(64),
  dedupeKey: z.string().trim().min(1).max(255),
  locale: z.enum(routing.locales),
});

export async function sendNotification(
  input: SendNotificationInput,
  deps: SendNotificationDeps = {},
): Promise<SendNotificationResult> {
  let log: NotificationLogger | undefined = deps.log;
  try {
    log ??= logger();
    return await send(input, deps, log);
  } catch (error) {
    // Error name only: a driver or template message may quote data.
    const errorName = error instanceof Error ? error.name : typeof error;
    try {
      log?.error({ kind: input.kind, code: "INTERNAL_ERROR", errorName }, "notification.error");
    } catch {
      // Logging must not turn a handled failure into an exception.
    }
    return { outcome: "failed", code: "INTERNAL_ERROR" };
  }
}

async function send(
  input: SendNotificationInput,
  deps: SendNotificationDeps,
  log: NotificationLogger,
): Promise<SendNotificationResult> {
  const now = deps.now ?? (() => new Date());
  const leaseMs = deps.leaseMs ?? NOTIFICATION_DEFAULTS.leaseMs;

  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    log.warn({ code: "INVALID_NOTIFICATION" }, "notification.invalid");
    return { outcome: "failed", code: "INVALID_NOTIFICATION" };
  }
  const { kind, bookingId, dedupeKey, locale } = parsed.data;
  const client = db();

  // Recipient read now, never stored (BR-60).
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: { reference: true, customer: { select: { email: true } } },
  });
  if (!booking) {
    log.warn({ kind, code: "BOOKING_NOT_FOUND" }, "notification.failed");
    return { outcome: "failed", code: "BOOKING_NOT_FOUND" };
  }
  const context = { bookingRef: booking.reference, kind };

  await client.notification.createMany({
    data: [{ bookingId, kind, locale, dedupeKey }],
    skipDuplicates: true,
  });
  const row = await client.notification.findUniqueOrThrow({ where: { dedupeKey } });
  const notificationId = row.id;

  if (row.bookingId !== bookingId || row.kind !== kind) {
    log.error({ ...context, notificationId, code: "DEDUPE_KEY_CONFLICT" }, "notification.failed");
    return { outcome: "failed", code: "DEDUPE_KEY_CONFLICT", notificationId };
  }
  if (row.status === "SENT") {
    return { outcome: "skipped", reason: "ALREADY_SENT", notificationId };
  }
  const startedAt = now();
  if (isInFlight(row, startedAt, leaseMs)) {
    return { outcome: "skipped", reason: "IN_PROGRESS", notificationId };
  }

  // Compare-and-set: of several concurrent callers, exactly one moves `attempts` forward.
  const claimed = await client.notification.updateMany({
    where: { id: notificationId, attempts: row.attempts, status: row.status },
    data: {
      status: "PENDING",
      attempts: { increment: 1 },
      lastAttemptAt: startedAt,
      lastErrorCode: null,
    },
  });
  if (claimed.count === 0) {
    const current = await client.notification.findUniqueOrThrow({
      where: { id: notificationId },
      select: { status: true },
    });
    const reason = current.status === "SENT" ? "ALREADY_SENT" : "IN_PROGRESS";
    return { outcome: "skipped", reason, notificationId };
  }
  const attempts = row.attempts + 1;

  const fail = async (code: NotificationFailureCode): Promise<SendNotificationResult> => {
    // Only this attempt's own claim is closed: a later attempt is never overwritten.
    await client.notification.updateMany({
      where: { id: notificationId, attempts, status: "PENDING" },
      data: { status: "FAILED", lastErrorCode: code },
    });
    log.warn({ ...context, notificationId, attempts, code }, "notification.failed");
    return { outcome: "failed", code, notificationId };
  };

  let message: { subject: string; html: string; text: string };
  try {
    const rendered = await input.render({ bookingReference: booking.reference, locale });
    message = { subject: rendered.subject, ...(await renderEmail(rendered.element)) };
  } catch {
    return fail("EMAIL_RENDER_FAILED");
  }

  const sender = deps.sender ?? emailSender();
  const result = await sender
    .send({
      to: booking.customer.email,
      ...message,
      idempotencyKey: providerIdempotencyKey(dedupeKey),
    })
    .catch(() => ({ ok: false as const, code: "EMAIL_PROVIDER_ERROR" as const }));
  if (!result.ok) return fail(result.code);

  // Sent is a fact: recorded whatever attempt currently holds the row.
  await client.notification.updateMany({
    where: { id: notificationId, status: { not: "SENT" } },
    data: {
      status: "SENT",
      providerMessageId: result.messageId,
      sentAt: now(),
      lastErrorCode: null,
    },
  });
  log.info({ ...context, notificationId, attempts }, "notification.sent");
  return { outcome: "sent", notificationId, attempts };
}

function isInFlight(
  row: { status: NotificationStatus; lastAttemptAt: Date | null },
  at: Date,
  leaseMs: number,
): boolean {
  return (
    row.status === "PENDING" &&
    row.lastAttemptAt !== null &&
    at.getTime() - row.lastAttemptAt.getTime() < leaseMs
  );
}
