import { apiErrorBody, apiErrorResponse, apiLocale, type ApiErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { correlationIdFrom, runWithRequestContext } from "@/lib/request-context";
import { BookingCreationError } from "@/server/booking/create-booking";
import { submitBookingRequest } from "@/server/booking/request-booking";
import { databaseUnavailableReason } from "@/server/db-errors";
import { publicBookingEnabled } from "@/server/public-booking";

// Prisma and the Stripe SDK (Node); never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operational faults (logged as errors); other refusals are ordinary answers to the request. */
const SERVER_FAULTS: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "NO_ACTIVE_PRICING_RULE",
  "PRICING_UNAVAILABLE",
  "BOOKING_REFERENCE_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "PAYMENT_UNAVAILABLE",
]);

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Public booking request (VTC-045, docs/architecture/api.md): creates a `REQUESTED` booking with
 * a server-recomputed price (BR-12) and the payment method saved through `payment-setups`, or
 * answers with the booking the same SetupIntent and email already created (double submission).
 * Thin handler: exposure switch, JSON parsing, the idempotent service, and error mapping to
 * `{ error: { code, message, correlationId } }`.
 *
 * The correlation id is always drawn by the server: it reaches the AuditLog, so an anonymous
 * client never chooses it. Logs carry codes, reasons and the public reference only: never a
 * name, an email, a place, a Stripe id or a Stripe message (BR-60).
 *
 * Off unless `PUBLIC_BOOKING_ENABLED` (404, no Stripe call, no write). Not rate limited: per-IP
 * limits (INFRA-005) are a prerequisite of production enablement (INFRA-006).
 */
export async function POST(request: Request) {
  const correlationId = correlationIdFrom(request.headers, { ignoreIncoming: true });
  const locale = apiLocale(request.headers.get("accept-language"));
  const headers = { "cache-control": "no-store", "x-request-id": correlationId };
  const fail = (code: ApiErrorCode, status?: number) =>
    apiErrorResponse(code, { correlationId, locale, status, headers });

  return runWithRequestContext({ correlationId }, async () => {
    try {
      if (!publicBookingEnabled()) return fail("NOT_FOUND");
    } catch (error) {
      // Invalid environment: fail closed, logging the error name only.
      logger().error({ errorName: errorName(error) }, "booking request failed");
      return fail("INTERNAL_ERROR");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger().info({ code: "INVALID_INPUT", reason: "invalid_json" }, "booking request refused");
      return fail("INVALID_INPUT");
    }

    try {
      const booking = await submitBookingRequest(body);
      // Neither the price, an internal id nor a Stripe id: the public reference and status only.
      return Response.json(
        { booking: { reference: booking.reference, status: booking.status } },
        { status: booking.replayed ? 200 : 201, headers },
      );
    } catch (error) {
      if (error instanceof BookingCreationError) {
        const temporary = error.details.temporary ?? false;
        const level = SERVER_FAULTS.has(error.code) ? "error" : temporary ? "warn" : "info";
        logger()[level](
          { code: error.code, reason: error.reason, temporary },
          "booking request refused",
        );
        if (error.code === "PRICE_CHANGED" && error.details.total) {
          // The new server price (TTC), so that the form shows it before any new submission.
          const { amountCents, currency } = error.details.total;
          return Response.json(
            {
              ...apiErrorBody(error.code, correlationId, locale),
              total: { amountCents, currency },
            },
            { status: 409, headers },
          );
        }
        return fail(error.code, temporary ? 503 : undefined);
      }
      const databaseReason = databaseUnavailableReason(error);
      if (databaseReason !== null) {
        logger().error(
          { code: "DATABASE_UNAVAILABLE", reason: databaseReason },
          "booking request refused",
        );
        return fail("DATABASE_UNAVAILABLE");
      }
      // Unexpected: only the error name is logged. Its message or stack may quote the request
      // (a name, an email, a place: BR-60).
      logger().error({ errorName: errorName(error) }, "booking request failed");
      return fail("INTERNAL_ERROR");
    }
  });
}
