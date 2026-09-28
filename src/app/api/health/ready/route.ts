import { logger } from "@/lib/logger";
import { correlationIdFrom, runWithRequestContext } from "@/lib/request-context";
import { checkDatabase } from "@/server/health";

export const dynamic = "force-dynamic";

// Readiness: 503 takes the pod out of the Service until PostgreSQL answers again.
// The body never carries internal details (docs/architecture/api.md).
export async function GET(request: Request) {
  const correlationId = correlationIdFrom(request.headers);
  return runWithRequestContext({ correlationId }, async () => {
    const headers = { "cache-control": "no-store", "x-request-id": correlationId };
    const database = await checkDatabase();
    if (database.ok) {
      return Response.json({ status: "ready" }, { headers });
    }
    logger().error(
      { check: "database", reason: database.reason, err: database.error },
      "readiness check failed",
    );
    return Response.json(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Service temporarily unavailable.",
          correlationId,
        },
      },
      { status: 503, headers },
    );
  });
}
