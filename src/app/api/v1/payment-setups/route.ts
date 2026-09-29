import { apiErrorResponse, apiLocale, type ApiErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { correlationIdFrom, runWithRequestContext } from "@/lib/request-context";
import { PaymentSetupRequestError, requestPaymentSetup } from "@/server/payments";

// Stripe SDK (Node); never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payment method registration (VTC-031, docs/product/payments.md step 1): creates the Stripe
 * Customer and the off-session SetupIntent the booking form confirms with Stripe.js. Returns the
 * client secret only; nothing is charged. Thin handler: JSON parsing, the service, and error
 * mapping to `{ error: { code, message, correlationId } }`. Logs carry codes and reasons only:
 * never the email, a Stripe id or the client secret (BR-60).
 *
 * Not yet rate limited, like the quote endpoint: INFRA-005 (DEC-17) must add a per-IP limit
 * before this endpoint is exposed in production.
 */
export async function POST(request: Request) {
  const correlationId = correlationIdFrom(request.headers);
  const locale = apiLocale(request.headers.get("accept-language"));
  const headers = { "cache-control": "no-store", "x-request-id": correlationId };
  const fail = (code: ApiErrorCode) => apiErrorResponse(code, { correlationId, locale, headers });

  return runWithRequestContext({ correlationId }, async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger().info({ code: "INVALID_INPUT", reason: "invalid_json" }, "payment setup refused");
      return fail("INVALID_INPUT");
    }

    try {
      const setup = await requestPaymentSetup(body);
      logger().info("payment setup created");
      return Response.json({ paymentSetup: { clientSecret: setup.clientSecret } }, { headers });
    } catch (error) {
      if (error instanceof PaymentSetupRequestError) {
        const level = error.code === "PAYMENT_UNAVAILABLE" ? "error" : "info";
        logger()[level]({ code: error.code, reason: error.reason }, "payment setup refused");
        return fail(error.code);
      }
      logger().error(
        { errorName: error instanceof Error ? error.name : typeof error },
        "payment setup failed",
      );
      return fail("INTERNAL_ERROR");
    }
  });
}
