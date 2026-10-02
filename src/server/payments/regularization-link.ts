import "server-only";

import Stripe from "stripe";

import { resolveBookingContact } from "@/domain/booking/contact";
import { InvalidBookingReferenceError, normalizeReference } from "@/domain/booking/reference";
import {
  isRegularizationLinkUsable,
  regularizationStep,
  type RegularizationStep,
} from "@/domain/payment/regularization";
import {
  signRegularizationToken,
  verifyRegularizationToken,
} from "@/domain/payment/regularization-token";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  PaymentIntentError,
  StripeConfigError,
  stripePaymentAuthentication,
  type PaymentAuthenticationGateway,
} from "@/integrations/stripe";
import { EnvValidationError } from "@/lib/env/schema";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { checkAccess } from "@/server/auth/access";
import { BackOfficeAccessError } from "@/server/admin/bookings";
import { db } from "@/server/db";

/**
 * SCA regularisation link (VTC-042, DEC-27, docs/product/payments.md "Régularisation SCA").
 *
 * When the off-session charge asks for authentication, the Payment is `REQUIRES_ACTION`
 * (VTC-033) and the customer authenticates the same PaymentIntent, on session, from a page
 * reached by a signed link. This module generates the link, and resolves it for the page:
 *
 * - the token (`src/domain/payment/regularization-token.ts`) is signed with
 *   `PAYMENT_LINK_SECRET` over the Payment id and the charge attempt: a retry (VTC-041)
 *   invalidates the earlier links; nothing is stored, no migration;
 * - the link is usable only while the state allows it (`isRegularizationLinkUsable`): no
 *   invented duration (DEC-13 will add an absolute deadline);
 * - every refusal is the same `invalid` outcome, shown as one generic 404 page: the caller never
 *   learns whether the token, the Payment or the booking was the reason;
 * - nothing here writes: `PAID`/`CONFIRMED` or `FAILED` come from the webhooks (BR-41).
 *
 * Logs carry the booking reference and a reason, never the token, the URL, the client secret
 * or a Stripe id (BR-60).
 */

/** What the customer sees: reference, pickup instant, frozen TTC amount. No personal data. */
export type RegularizationSummary = Readonly<{
  bookingRef: string;
  pickupAt: Date;
  amountCents: number;
  currency: string;
}>;

export type RegularizationPage = Readonly<
  | { kind: "invalid" }
  | {
      kind: "authenticate";
      summary: RegularizationSummary;
      step: Extract<RegularizationStep, "confirm" | "next_action">;
      /** PaymentIntent client secret: handed to Stripe.js on this page only, never logged. */
      clientSecret: string;
      /** The payment method saved at the request: the same card, never a new one. */
      paymentMethodId: string;
      /** `pk_test_` only (VTC-030 guard). */
      publishableKey: string;
    }
  | { kind: "settled" | "closed" | "unavailable"; summary: RegularizationSummary }
>;

export interface RegularizationDeps {
  readonly db?: PrismaClient;
  /** Resolved on use: a missing or live key is a technical failure (page "unavailable"). */
  readonly gateway?: () => PaymentAuthenticationGateway;
  readonly now?: () => Date;
}

/**
 * `PAYMENT_LINK_SECRET`, null when it is not configured (or the environment does not validate):
 * no link is generated and every link is invalid. The configuration error is logged by name
 * only, never with a value.
 */
function linkKey(): string | null {
  let key: string | undefined;
  try {
    key = serverEnv().PAYMENT_LINK_SECRET;
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    logger().error({ errorName: error.name }, "regularisation link: invalid environment");
    return null;
  }
  if (!key) {
    logger().error(
      { variable: "PAYMENT_LINK_SECRET", reason: "not_configured" },
      "regularisation link unavailable: PAYMENT_LINK_SECRET is not configured",
    );
    return null;
  }
  return key;
}

/**
 * Absolute URL of the regularisation page for attempt `attempt` of a Payment, in the customer's
 * language (`/paiement/{token}` or `/en/payment/{token}`, DEC-21), from `APP_URL`. Null without
 * `PAYMENT_LINK_SECRET`. Used by the back-office copy button and by the email of VTC-044.
 */
export function paymentRegularizationUrl(
  paymentId: string,
  attempt: number,
  locale: Locale,
): string | null {
  const key = linkKey();
  if (!key) return null;
  const token = signRegularizationToken({ paymentId, attempt }, key);
  const pathname = getPathname({
    href: { pathname: "/paiement/[token]", params: { token } },
    locale,
  });
  return new URL(pathname, serverEnv().APP_URL).toString();
}

function isTechnicalStripeFailure(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError ||
    error instanceof StripeConfigError ||
    error instanceof PaymentIntentError
  );
}

/**
 * Resolves a token from the URL for the customer's page. Read-only: no write in the database,
 * no write at Stripe (one PaymentIntent read).
 */
export async function resolveRegularizationLink(
  token: string,
  deps: RegularizationDeps = {},
): Promise<RegularizationPage> {
  const log = logger();
  const invalid = (reason: string, bookingRef: string | null = null): RegularizationPage => {
    log.info({ bookingRef, reason }, "regularisation link refused");
    return { kind: "invalid" };
  };

  const key = linkKey();
  if (!key) return { kind: "invalid" };
  const claim = verifyRegularizationToken(token, key);
  if (!claim) return invalid("bad_token");

  const client = deps.db ?? db();
  const payment = await client.payment.findUnique({
    where: { id: claim.paymentId },
    select: {
      id: true,
      bookingId: true,
      status: true,
      attempt: true,
      amountCents: true,
      currency: true,
      stripeCustomerId: true,
      stripePaymentMethodId: true,
      stripePaymentIntentId: true,
      booking: {
        select: {
          id: true,
          reference: true,
          status: true,
          currentPaymentId: true,
          pickupAt: true,
        },
      },
    },
  });
  const booking = payment?.booking ?? null;
  const now = (deps.now ?? (() => new Date()))();
  if (!payment || !booking || !isRegularizationLinkUsable({ claim, payment, booking }, now)) {
    return invalid("state", booking?.reference ?? null);
  }
  // Checked by isRegularizationLinkUsable; narrows the type.
  const paymentIntentId = payment.stripePaymentIntentId;
  if (paymentIntentId === null) return invalid("state", booking.reference);

  const bookingRef = booking.reference;
  const summary: RegularizationSummary = {
    bookingRef,
    pickupAt: booking.pickupAt,
    amountCents: payment.amountCents,
    currency: payment.currency,
  };

  let read;
  try {
    read = await (
      deps.gateway ?? stripePaymentAuthentication
    )().retrievePaymentIntentForAuthentication(paymentIntentId);
  } catch (error) {
    if (!isTechnicalStripeFailure(error)) throw error;
    log.error(
      { bookingRef, errorName: error instanceof Error ? error.name : "unknown" },
      "regularisation page: PaymentIntent could not be read",
    );
    return { kind: "unavailable", summary };
  }

  const intent = read?.intent;
  // The PaymentIntent must be the one of this Payment and attempt, for its frozen amount: a
  // mismatch is never offered for confirmation (BR-12).
  const mismatch = !intent
    ? "unknown_payment_intent"
    : intent.id !== paymentIntentId
      ? "other_payment_intent"
      : intent.livemode
        ? "live_payment_intent"
        : intent.customerId !== payment.stripeCustomerId
          ? "customer_mismatch"
          : intent.attempt !== payment.attempt
            ? "attempt_mismatch"
            : intent.amountCents !== payment.amountCents || intent.currency !== payment.currency
              ? "amount_mismatch"
              : null;
  if (!read || !intent || mismatch) {
    log.error({ bookingRef, reason: mismatch }, "regularisation page: PaymentIntent inconsistent");
    return { kind: "closed", summary };
  }

  const step = regularizationStep({
    status: intent.status,
    errorCode: intent.lastPaymentErrorCode,
    declineCode: intent.lastPaymentErrorDeclineCode,
  });
  if (step === "settled" || step === "closed") {
    log.info({ bookingRef, step, stripeStatus: intent.status }, "regularisation page shown");
    return { kind: step, summary };
  }

  const publishableKey = serverEnv().NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey || !read.clientSecret) {
    log.error(
      {
        bookingRef,
        reason: publishableKey ? "no_client_secret" : "publishable_key_not_configured",
      },
      "regularisation page: authentication cannot be offered",
    );
    return { kind: "unavailable", summary };
  }
  log.info({ bookingRef, step }, "regularisation page shown");
  return {
    kind: "authenticate",
    summary,
    step,
    clientSecret: read.clientSecret,
    paymentMethodId: payment.stripePaymentMethodId,
    publishableKey,
  };
}

export type BackOfficeRegularizationLink = Readonly<
  | { status: "available"; url: string }
  /** `PAYMENT_LINK_SECRET` is missing: no link can be generated. */
  | { status: "not_configured" }
  /** No usable link for this booking now (status, attempt, pickup passed…). */
  | { status: "not_applicable" }
>;

/**
 * The regularisation link of a booking for the back-office copy button, `ADMIN` only: the
 * current Payment must be usable by a link right now (same rules as the page). In the language
 * of the booking's contact. The URL is shown to the admin, never logged.
 */
export async function backOfficeRegularizationLink(
  requestHeaders: Headers,
  rawReference: string,
  deps: Pick<RegularizationDeps, "db" | "now"> = {},
): Promise<BackOfficeRegularizationLink> {
  const access = await checkAccess(requestHeaders, ["ADMIN"]);
  if (!access.ok) throw new BackOfficeAccessError(access.reason);

  let reference: string;
  try {
    reference = normalizeReference(rawReference);
  } catch (error) {
    if (error instanceof InvalidBookingReferenceError) return { status: "not_applicable" };
    throw error;
  }

  const booking = await (deps.db ?? db()).booking.findUnique({
    where: { reference },
    select: {
      id: true,
      status: true,
      currentPaymentId: true,
      pickupAt: true,
      contactName: true,
      contactPhone: true,
      contactLocale: true,
      customer: { select: { name: true, phone: true, preferredLocale: true } },
      currentPayment: {
        select: {
          id: true,
          bookingId: true,
          status: true,
          attempt: true,
          stripePaymentIntentId: true,
        },
      },
    },
  });
  const payment = booking?.currentPayment ?? null;
  if (!booking || !payment) return { status: "not_applicable" };
  const now = (deps.now ?? (() => new Date()))();
  const claim = { paymentId: payment.id, attempt: payment.attempt };
  if (!isRegularizationLinkUsable({ claim, payment, booking }, now)) {
    return { status: "not_applicable" };
  }

  const { contactName, contactPhone, contactLocale, customer } = booking;
  const { locale } = resolveBookingContact({ contactName, contactPhone, contactLocale }, customer);
  const url = paymentRegularizationUrl(payment.id, payment.attempt, locale);
  return url ? { status: "available", url } : { status: "not_configured" };
}
