"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { type ChargeRetryResult, runChargeRetry } from "@/server/payments/retry-charge-action";

// Back-office manual retry of a failed charge (VTC-041, DEC-27). Next.js checks the Origin of
// every server action (CSRF); `runChargeRetry` re-checks session, ADMIN role and 2FA and
// validates the input on every call. The page is refreshed after any outcome, so that the
// Payment status, attempt and booking status shown are the current ones.

export type ChargeRetryState = ChargeRetryResult | null;

export async function retryChargeAction(
  _previous: ChargeRetryState,
  formData: FormData,
): Promise<ChargeRetryState> {
  const result = await runChargeRetry(await headers(), {
    reference: formData.get("reference"),
    expectedPaymentVersion: formData.get("expectedPaymentVersion"),
  });
  refresh();
  return result;
}
