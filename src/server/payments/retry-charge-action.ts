import "server-only";

import { z } from "zod";

import { CHARGE_RETRY_ROLES } from "@/domain/payment/retry";
import { InvalidBookingReferenceError, normalizeReference } from "@/domain/booking/reference";
import { stripePaymentIntents } from "@/integrations/stripe";
import { logger } from "@/lib/logger";
import {
  correlationIdFrom,
  currentCorrelationId,
  runWithRequestContext,
} from "@/lib/request-context";
import { checkAccess } from "@/server/auth/access";
import { databaseUnavailableReason } from "@/server/db-errors";

import {
  type ChargeRetryErrorCode,
  ChargeRetryError,
  type ChargeRetryOutcome,
  retryBookingCharge,
  type RetryChargeDeps,
} from "./retry-charge";

/**
 * Body of the back-office "retry the charge" server action (VTC-041), kept out of the
 * `"use server"` file so that it can be tested with real sessions. Every call re-checks the
 * session, the role (ADMIN only, DEC-27) and the 2FA server-side before reading the input
 * (Master Spec §18): a hidden button is not a security boundary. Errors reach the UI as
 * `{ code, message, correlationId }`, French only like the rest of the back-office.
 */

/** What the client may send: which booking and the Payment version it displayed. */
export const ChargeRetryInputSchema = z.strictObject({
  reference: z.string().trim().min(1).max(64),
  expectedPaymentVersion: z.coerce.number().int().positive().max(2_147_483_647),
});

export const CHARGE_RETRY_ERROR_MESSAGES = {
  INVALID_INPUT: "La demande envoyée est invalide. Rechargez la page et réessayez.",
  ACCESS_DENIED:
    "Seul un associé (administrateur avec double authentification) peut relancer un débit. Reconnectez-vous si besoin.",
  BOOKING_NOT_FOUND: "Cette réservation est introuvable.",
  PAYMENT_NOT_RETRYABLE:
    "Ce paiement ne peut pas être relancé dans son état actuel. La page a été actualisée.",
  PAYMENT_STATE_INCONSISTENT:
    "Le paiement de cette réservation est incohérent : aucun débit n’a été lancé. Vérifiez le compte Stripe avant toute action.",
  PAYMENT_AMOUNT_MISMATCH:
    "Les montants de la réservation et du paiement ne concordent pas : aucun débit n’a été lancé.",
  PAYMENT_IN_PROGRESS:
    "Un paiement est en cours de traitement chez Stripe : aucun nouveau débit n’a été lancé. Réessayez plus tard.",
  PAYMENT_CONCURRENT_UPDATE:
    "Ce paiement a été modifié entre-temps (double clic ou autre associé). La page a été actualisée : vérifiez son état avant d’agir.",
  PAYMENT_UNAVAILABLE:
    "Stripe est momentanément injoignable : aucun débit n’a été lancé et rien n’a été modifié. Réessayez plus tard.",
  PAYMENT_ATTEMPT_INTERRUPTED:
    "Stripe n’a pas répondu : la tentative a été enregistrée sans résultat. Réessayez plus tard ; la relance vérifiera Stripe avant tout nouveau débit.",
  DATABASE_UNAVAILABLE: "Service momentanément indisponible. Aucun débit n’a été lancé.",
  INTERNAL_ERROR:
    "Une erreur inattendue est survenue. Vérifiez l’état du paiement avant de réessayer.",
} as const satisfies Record<
  ChargeRetryErrorCode | "INVALID_INPUT" | "DATABASE_UNAVAILABLE" | "INTERNAL_ERROR",
  string
>;

export type ChargeRetryActionErrorCode = keyof typeof CHARGE_RETRY_ERROR_MESSAGES;

export type ChargeRetryActionError = Readonly<{
  code: ChargeRetryActionErrorCode;
  message: string;
  correlationId: string;
}>;

export type ChargeRetryResult =
  | Readonly<{ ok: true } & ChargeRetryOutcome>
  | Readonly<{ ok: false; error: ChargeRetryActionError }>;

function readInput(input: unknown) {
  const parsed = ChargeRetryInputSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    return {
      reference: normalizeReference(parsed.data.reference),
      expectedPaymentVersion: parsed.data.expectedPaymentVersion,
    };
  } catch (error) {
    if (error instanceof InvalidBookingReferenceError) return null;
    throw error;
  }
}

function errorCode(error: unknown): ChargeRetryActionErrorCode {
  if (error instanceof ChargeRetryError) return error.code;
  if (databaseUnavailableReason(error) !== null) return "DATABASE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

export async function runChargeRetry(
  requestHeaders: Headers,
  input: unknown,
  deps: RetryChargeDeps = { gateway: stripePaymentIntents },
): Promise<ChargeRetryResult> {
  const correlationId = currentCorrelationId() ?? correlationIdFrom(requestHeaders);

  return runWithRequestContext({ correlationId }, async () => {
    const fail = (code: ChargeRetryActionErrorCode): ChargeRetryResult => ({
      ok: false,
      error: { code, message: CHARGE_RETRY_ERROR_MESSAGES[code], correlationId },
    });

    const access = await checkAccess(requestHeaders, CHARGE_RETRY_ROLES);
    if (!access.ok) {
      logger().warn({ reason: access.reason }, "charge retry refused: access");
      return fail("ACCESS_DENIED");
    }

    const request = readInput(input);
    if (!request) return fail("INVALID_INPUT");

    const actor = { role: access.user.role, userId: access.user.userId };
    try {
      const outcome = await retryBookingCharge(
        request.reference,
        request.expectedPaymentVersion,
        actor,
        deps,
      );
      return { ok: true, ...outcome };
    } catch (error) {
      const code = errorCode(error);
      if (code === "INTERNAL_ERROR") {
        logger().error(
          {
            bookingRef: request.reference,
            code,
            errorName: error instanceof Error ? error.name : "unknown",
          },
          "charge retry failed",
        );
      }
      return fail(code);
    }
  });
}
