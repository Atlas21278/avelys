import "server-only";

import { z } from "zod";

import { InvalidBookingTransitionError } from "@/domain/booking/transitions";
import { databaseUnavailableReason } from "@/server/db-errors";

import { BookingDecisionError } from "./decide-booking";

/**
 * Input and error contract of the back-office accept/refuse actions (VTC-032). The back-office is
 * French only, so messages are French. An error reaches the UI as `{ code, message,
 * correlationId }`: never a stack trace, a Prisma message or personal data.
 */

/**
 * What the client may send: which booking and the version it displayed. Nothing else — the
 * decision is fixed by the action called, the actor comes from the session.
 */
export const BookingDecisionInputSchema = z.strictObject({
  reference: z.string().trim().min(1).max(64),
  expectedVersion: z.coerce.number().int().positive().max(2_147_483_647),
});

export type BookingDecisionInput = z.input<typeof BookingDecisionInputSchema>;

export const DECISION_ERROR_MESSAGES = {
  INVALID_INPUT: "La demande envoyée est invalide. Rechargez la page et réessayez.",
  ACCESS_DENIED:
    "Votre session ne permet pas cette action (session expirée, rôle insuffisant ou double authentification absente). Reconnectez-vous.",
  BOOKING_NOT_FOUND: "Cette réservation est introuvable.",
  INVALID_BOOKING_TRANSITION:
    "Cette demande n’est plus à traiter : son statut a changé. La page a été actualisée.",
  BOOKING_CONCURRENT_UPDATE:
    "Cette réservation a été modifiée entre-temps par un collègue. La page a été actualisée : vérifiez son état avant d’agir.",
  DATABASE_UNAVAILABLE: "Service momentanément indisponible. Aucune modification n’a été faite.",
  INTERNAL_ERROR: "Une erreur inattendue est survenue. Aucune modification n’a été faite.",
} as const satisfies Record<string, string>;

export type DecisionErrorCode = keyof typeof DECISION_ERROR_MESSAGES;

export type DecisionError = Readonly<{
  code: DecisionErrorCode;
  message: string;
  correlationId: string;
}>;

/** Stable code for an error raised while deciding; unknown errors are `INTERNAL_ERROR`. */
export function decisionErrorCode(error: unknown): DecisionErrorCode {
  if (error instanceof InvalidBookingTransitionError) return "INVALID_BOOKING_TRANSITION";
  if (error instanceof BookingDecisionError) return error.code;
  if (databaseUnavailableReason(error) !== null) return "DATABASE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

export function decisionError(code: DecisionErrorCode, correlationId: string): DecisionError {
  return { code, message: DECISION_ERROR_MESSAGES[code], correlationId };
}
