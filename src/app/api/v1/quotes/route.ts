import { apiErrorResponse, apiLocale, type ApiErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { correlationIdFrom, runWithRequestContext } from "@/lib/request-context";
import { quote, QuoteError } from "@/server/quotes";

export const dynamic = "force-dynamic";

/**
 * Public quote (VTC-027, docs/architecture/api.md). Thin handler: JSON parsing, the server
 * quote service, and error mapping to `{ error: { code, message, correlationId } }`.
 * The price comes from the server only (BR-12); nothing about a place is logged (BR-60).
 *
 * Not yet rate limited: a dedicated ticket must add rate limiting / anti-spam before this
 * endpoint is exposed in production (INFRA-005, DEC-17).
 */
export async function POST(request: Request) {
  const correlationId = correlationIdFrom(request.headers);
  const locale = apiLocale(request.headers.get("accept-language"));
  const headers = { "cache-control": "no-store", "x-request-id": correlationId };
  const fail = (code: ApiErrorCode, status?: number) =>
    apiErrorResponse(code, { correlationId, locale, status, headers });

  return runWithRequestContext({ correlationId }, async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger().info({ code: "INVALID_INPUT", reason: "invalid_json" }, "quote refused");
      return fail("INVALID_INPUT");
    }

    try {
      const result = await quote(body);
      const { snapshot } = result;
      logger().info(
        {
          snapshotId: result.snapshotId,
          pricingRuleId: snapshot.rule.id,
          pricingRuleVersion: snapshot.rule.version,
          totalTtcCents: result.total.amountCents,
          distanceMeters: snapshot.route.distanceMeters,
          binding: snapshot.baseFare.binding,
        },
        "quote computed",
      );
      return Response.json(
        {
          quote: {
            snapshotId: result.snapshotId,
            currency: result.total.currency,
            totalTtcCents: result.total.amountCents,
            totalHtCents: result.totalHtCents,
            vatCents: result.vatCents,
            distanceMeters: snapshot.route.distanceMeters,
            durationSeconds: snapshot.route.durationSeconds,
            pickupAt: snapshot.inputs.pickupAt,
            pickupLocalDateTime: snapshot.inputs.pickupLocalDateTime,
            timeZone: snapshot.inputs.timeZone,
            quotedAt: snapshot.quotedAt,
            pricingRuleVersion: snapshot.rule.version,
          },
        },
        { headers },
      );
    } catch (error) {
      if (error instanceof QuoteError) {
        // A missing or invalid rule is an operational fault; a provider outage is transient;
        // the rest are ordinary refusals of the request.
        const level =
          error.code === "NO_ACTIVE_PRICING_RULE" || error.code === "PRICING_UNAVAILABLE"
            ? "error"
            : error.temporary
              ? "warn"
              : "info";
        logger()[level](
          { code: error.code, reason: error.reason, temporary: error.temporary },
          "quote refused",
        );
        return fail(error.code, error.temporary ? 503 : undefined);
      }
      // Unexpected: details go to the logs only, never to the response.
      logger().error({ err: error }, "quote failed");
      return fail("INTERNAL_ERROR");
    }
  });
}
