import "server-only";

import { BACK_OFFICE_ROLES } from "@/domain/auth/access";
import { InvalidBookingReferenceError, normalizeReference } from "@/domain/booking/reference";
import { logger } from "@/lib/logger";
import {
  correlationIdFrom,
  currentCorrelationId,
  runWithRequestContext,
} from "@/lib/request-context";
import { checkAccess } from "@/server/auth/access";

import {
  acceptBooking,
  type BookingDecision,
  type DecideBookingDeps,
  refuseBooking,
} from "./decide-booking";
import {
  BookingDecisionInputSchema,
  type DecisionError,
  decisionError,
  decisionErrorCode,
} from "./decision-errors";

/**
 * Body of the back-office accept/refuse server actions (VTC-032), kept out of the `"use server"`
 * file so that it can be tested with real sessions. Every call re-checks the session, the role
 * (ADMIN or DISPATCHER) and the 2FA server-side before reading the input (Master Spec §18): a
 * hidden button is not a security boundary. Nothing is written when any check fails.
 */

export type BookingDecisionResult =
  | Readonly<{ ok: true; reference: string; status: BookingDecision; version: number }>
  | Readonly<{ ok: false; error: DecisionError }>;

function readInput(input: unknown) {
  const parsed = BookingDecisionInputSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    return {
      reference: normalizeReference(parsed.data.reference),
      expectedVersion: parsed.data.expectedVersion,
    };
  } catch (error) {
    if (error instanceof InvalidBookingReferenceError) return null;
    throw error;
  }
}

export async function runBookingDecision(
  requestHeaders: Headers,
  decision: BookingDecision,
  input: unknown,
  deps: DecideBookingDeps = {},
): Promise<BookingDecisionResult> {
  const correlationId = currentCorrelationId() ?? correlationIdFrom(requestHeaders);

  return runWithRequestContext({ correlationId }, async () => {
    const fail = (code: Parameters<typeof decisionError>[0]): BookingDecisionResult => ({
      ok: false,
      error: decisionError(code, correlationId),
    });

    const access = await checkAccess(requestHeaders, BACK_OFFICE_ROLES);
    if (!access.ok) {
      logger().warn({ decision, reason: access.reason }, "booking decision refused: access");
      return fail("ACCESS_DENIED");
    }

    const request = readInput(input);
    if (!request) return fail("INVALID_INPUT");

    const actor = { role: access.user.role, userId: access.user.userId };
    try {
      const decided =
        decision === "ACCEPTED"
          ? await acceptBooking(request.reference, request.expectedVersion, actor, deps)
          : await refuseBooking(request.reference, request.expectedVersion, actor, deps);
      return {
        ok: true,
        reference: decided.reference,
        status: decided.status,
        version: decided.version,
      };
    } catch (error) {
      const code = decisionErrorCode(error);
      const fields = { bookingRef: request.reference, decision, code };
      if (code === "INTERNAL_ERROR") {
        logger().error(
          { ...fields, errorName: error instanceof Error ? error.name : "unknown" },
          "booking decision failed",
        );
      } else {
        logger().info(fields, "booking decision not applied");
      }
      return fail(code);
    }
  });
}
