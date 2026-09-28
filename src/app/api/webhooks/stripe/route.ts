import { apiErrorResponse, apiLocale, type ApiErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { correlationIdFrom, runWithRequestContext } from "@/lib/request-context";
import {
  receiveStripeWebhook,
  StripeWebhookError,
  StripeWebhookProcessingError,
} from "@/server/payments/process-webhook";

// Signature verification needs Node crypto and the exact raw body; never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint (VTC-030, docs/product/payments.md). Unauthenticated and outside CSRF
 * checks: the Stripe signature over the raw body is the only trust. Thin handler: raw body,
 * `receiveStripeWebhook` (verify, record, dispatch), and error mapping to `{ error: { code,
 * message, correlationId } }`. Logs carry `eventId`, `eventType` and the correlation id only:
 * never the payload, the signature header or a secret (BR-60).
 *
 * Any non-2xx answer makes Stripe retry, which is what a failed handler needs.
 */
export async function POST(request: Request) {
  const correlationId = correlationIdFrom(request.headers);
  const locale = apiLocale(request.headers.get("accept-language"));
  const headers = { "cache-control": "no-store", "x-request-id": correlationId };
  const fail = (code: ApiErrorCode) => apiErrorResponse(code, { correlationId, locale, headers });

  return runWithRequestContext({ correlationId }, async () => {
    try {
      const rawBody = await request.text();
      const received = await receiveStripeWebhook(rawBody, request.headers.get("stripe-signature"));
      logger().info(received, "stripe webhook received");
      return Response.json({ received: true }, { headers });
    } catch (error) {
      if (error instanceof StripeWebhookError) {
        if (error.code === "WEBHOOK_NOT_CONFIGURED") {
          logger().error({ code: error.code }, "stripe webhook refused");
          return fail("WEBHOOK_NOT_CONFIGURED");
        }
        logger().warn({ code: error.code }, "stripe webhook refused");
        return fail(
          error.code === "INVALID_WEBHOOK_SIGNATURE"
            ? "INVALID_WEBHOOK_SIGNATURE"
            : "INVALID_INPUT",
        );
      }
      if (error instanceof StripeWebhookProcessingError) {
        // Rolled back: nothing recorded, Stripe retries and the event is processed again.
        logger().error(
          { eventId: error.eventId, eventType: error.eventType, errorName: nameOf(error.cause) },
          "stripe webhook failed",
        );
        return fail("INTERNAL_ERROR");
      }
      // Unexpected (e.g. invalid environment): the error name only, its message may hold values.
      logger().error({ errorName: nameOf(error) }, "stripe webhook failed");
      return fail("INTERNAL_ERROR");
    }
  });
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
