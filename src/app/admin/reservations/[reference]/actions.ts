"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { type BookingDecisionResult, runBookingDecision } from "@/server/booking/decision-action";
import { chargeAcceptedBooking } from "@/server/payments";

// Back-office accept/refuse (VTC-032). Next.js checks the Origin of every server action (CSRF);
// `runBookingDecision` re-checks session, role and 2FA and validates the input on every call.
// The page is refreshed after any outcome, so a conflict shows the booking's current state.
// Accepting charges the saved card off-session after commit (VTC-033): the page then shows the
// payment status, and the booking becomes CONFIRMED once the payment succeeded.

export type DecisionState = BookingDecisionResult | null;

function inputFrom(formData: FormData) {
  return {
    reference: formData.get("reference"),
    expectedVersion: formData.get("expectedVersion"),
  };
}

export async function acceptBookingAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const result = await runBookingDecision(await headers(), "ACCEPTED", inputFrom(formData), {
    onBookingAccepted: chargeAcceptedBooking,
  });
  refresh();
  return result;
}

export async function refuseBookingAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const result = await runBookingDecision(await headers(), "REFUSED", inputFrom(formData));
  refresh();
  return result;
}
