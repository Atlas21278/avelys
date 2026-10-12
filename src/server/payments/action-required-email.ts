import "server-only";

import { createElement } from "react";

import { resolveBookingContact } from "@/domain/booking/contact";
import { paymentActionRequiredDedupeKey } from "@/domain/payment/action-required-email";
import { isRegularizationLinkUsable } from "@/domain/payment/regularization";
import {
  PaymentActionRequiredEmail,
  paymentActionRequiredSubject,
} from "@/emails/payment-action-required";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { EmailSender } from "@/integrations/email/sender";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import {
  sendNotification,
  type SendNotificationResult,
} from "@/server/notifications/send-notification";

import type { OnPaymentRequiresAction } from "./after-charge";
import { paymentRegularizationUrl } from "./regularization-link";

/**
 * Customer email "payment authentication required" (VTC-044, DEC-27, docs/product/payments.md
 * "Régularisation SCA"): the implementation of the post-commit port `onPaymentRequiresAction`.
 *
 * - Called after the commit that moved a Payment to `REQUIRES_ACTION` (synchronous charge, retry,
 *   webhook), outside any transaction. It writes `Notification` only (through
 *   `sendNotification`), never `Booking` or `Payment` (BR-50, rule 10), and never throws.
 * - One email per Payment and attempt (`payment-action-required:{paymentId}:{attempt}`): a
 *   replayed webhook, or the same attempt entering `REQUIRES_ACTION` again from the regularisation
 *   page, sends nothing more; a retry (VTC-041, `attempt + 1`) sends a new link.
 * - Nothing is sent when the link would already be unusable (Payment no longer current or no
 *   longer `REQUIRES_ACTION`, booking no longer `ACCEPTED`, pickup passed): no dead link.
 * - Without `PAYMENT_LINK_SECRET` no link exists: the rendering refuses, the notification is
 *   `FAILED` (`EMAIL_RENDER_FAILED`), never an email with an empty link.
 * - Language: the booking contact's (DEC-25), its customer profile's for older rows.
 *
 * Logs carry the booking reference and technical codes only: never the link (it holds a token),
 * the address or the content (BR-60).
 */

/** Thrown inside the rendering when no link can be signed: the notification becomes FAILED. */
export class PaymentLinkUnavailableError extends Error {
  constructor() {
    super("Regularisation link unavailable");
    this.name = "PaymentLinkUnavailableError";
  }
}

export interface PaymentActionEmailDeps {
  readonly db?: PrismaClient;
  readonly sender?: EmailSender;
  readonly now?: () => Date;
  /** Link generator; `paymentRegularizationUrl` (null without `PAYMENT_LINK_SECRET`). */
  readonly regularizationUrl?: (
    paymentId: string,
    attempt: number,
    locale: Locale,
  ) => string | null;
}

export type PaymentActionEmailResult =
  | SendNotificationResult
  | { readonly outcome: "not_applicable"; readonly reason: "PAYMENT_NOT_FOUND" | "LINK_UNUSABLE" };

/** Absolute URL of the contact page in `locale`, from `APP_URL`. */
function contactUrl(locale: Locale): string {
  return new URL(getPathname({ href: "/contact", locale }), serverEnv().APP_URL).toString();
}

export async function sendPaymentActionRequiredEmail(
  paymentId: string,
  deps: PaymentActionEmailDeps = {},
): Promise<PaymentActionEmailResult> {
  let bookingRef: string | null = null;
  try {
    const payment = await (deps.db ?? db()).payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        bookingId: true,
        status: true,
        attempt: true,
        amountCents: true,
        currency: true,
        stripePaymentIntentId: true,
        booking: {
          select: {
            id: true,
            reference: true,
            status: true,
            currentPaymentId: true,
            pickupAt: true,
            contactName: true,
            contactPhone: true,
            contactLocale: true,
            customer: { select: { name: true, phone: true, preferredLocale: true } },
          },
        },
      },
    });
    if (!payment) {
      logger().warn({ reason: "payment_not_found" }, "payment action email not sent");
      return { outcome: "not_applicable", reason: "PAYMENT_NOT_FOUND" };
    }
    const { booking } = payment;
    bookingRef = booking.reference;

    const now = (deps.now ?? (() => new Date()))();
    const claim = { paymentId: payment.id, attempt: payment.attempt };
    if (!isRegularizationLinkUsable({ claim, payment, booking }, now)) {
      logger().info(
        { bookingRef, attempt: payment.attempt, reason: "link_unusable" },
        "payment action email not sent",
      );
      return { outcome: "not_applicable", reason: "LINK_UNUSABLE" };
    }

    const { contactName, contactPhone, contactLocale, customer } = booking;
    const { locale } = resolveBookingContact(
      { contactName, contactPhone, contactLocale },
      customer,
    );
    const linkFor = deps.regularizationUrl ?? paymentRegularizationUrl;
    const summary = {
      bookingReference: booking.reference,
      pickupAt: booking.pickupAt,
      amountCents: payment.amountCents,
      currency: payment.currency,
    };

    return await sendNotification(
      {
        kind: "PAYMENT_ACTION_REQUIRED",
        bookingId: booking.id,
        dedupeKey: paymentActionRequiredDedupeKey(payment.id, payment.attempt),
        locale,
        render: () => {
          const paymentUrl = linkFor(payment.id, payment.attempt, locale);
          if (!paymentUrl) throw new PaymentLinkUnavailableError();
          return {
            subject: paymentActionRequiredSubject(locale, booking.reference),
            element: createElement(PaymentActionRequiredEmail, {
              ...summary,
              locale,
              paymentUrl,
              contactUrl: contactUrl(locale),
            }),
          };
        },
      },
      { ...(deps.sender ? { sender: deps.sender } : {}), ...(deps.now ? { now: deps.now } : {}) },
    );
  } catch (error) {
    // Error name only: a driver message may quote data.
    try {
      logger().error(
        { bookingRef, errorName: error instanceof Error ? error.name : "unknown" },
        "payment action email failed",
      );
    } catch {
      // Logging must not turn a handled failure into an exception.
    }
    return { outcome: "failed", code: "INTERNAL_ERROR" };
  }
}

/** Production implementation of the port: the email above, its outcome already logged. */
export const sendPaymentActionRequiredEmailPort: OnPaymentRequiresAction = async (paymentId) => {
  await sendPaymentActionRequiredEmail(paymentId);
};
