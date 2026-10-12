"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { type ChargeRetryState, retryChargeAction } from "./charge-retry-actions";

interface ChargeRetryProps {
  reference: string;
  paymentVersion: number;
  /** Frozen amount, already formatted, recalled in the confirmation. */
  amountLabel: string;
  /** Whether the server allows a retry for this state and role; the action re-checks it. */
  allowed: boolean;
}

function successMessage(state: Extract<NonNullable<ChargeRetryState>, { ok: true }>): string {
  if (state.outcome === "reconciled") {
    return "Paiement déjà reçu chez Stripe : la réservation a été rapprochée, aucun nouveau débit n’a été fait.";
  }
  switch (state.paymentStatus) {
    case "PAID":
      return `Tentative n° ${state.attempt} réussie : la réservation est confirmée.`;
    case "REQUIRES_ACTION":
      return `Tentative n° ${state.attempt} : la banque demande une authentification du client. La réservation reste « Acceptée ».`;
    case "FAILED":
      return `Tentative n° ${state.attempt} refusée par la banque. La réservation reste « Acceptée ».`;
    default:
      return `Tentative n° ${state.attempt} en cours de traitement chez Stripe : le résultat s’affichera à réception.`;
  }
}

/**
 * "Retry the charge" button of an `ACCEPTED` booking whose payment failed (VTC-041), behind an
 * explicit confirmation recalling the amount. Shown to ADMIN only; the server re-checks
 * everything. Stays mounted after the action so that its outcome remains visible after the
 * page refresh that follows.
 */
export function ChargeRetry({ reference, paymentVersion, amountLabel, allowed }: ChargeRetryProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, retry, pending] = useActionState<ChargeRetryState, FormData>(
    retryChargeAction,
    null,
  );

  if (!allowed && !state && !pending) return null;

  return (
    <div className="flex flex-col gap-4">
      {pending ? <p role="status">Vérification chez Stripe puis débit…</p> : null}
      {!pending && state && !state.ok ? (
        <p role="alert" className="border-l-2 border-rubric pl-3 text-rubric">
          {state.error.message}{" "}
          <span className="text-sm text-graphite">
            (référence incident : {state.error.correlationId})
          </span>
        </p>
      ) : null}
      {!pending && state?.ok ? <p role="status">{successMessage(state)}</p> : null}

      {allowed && confirming ? (
        <form
          action={retry}
          onSubmit={() => setConfirming(false)}
          className="flex flex-col gap-3 border border-hairline p-4"
        >
          <input type="hidden" name="reference" value={reference} />
          <input type="hidden" name="expectedPaymentVersion" value={paymentVersion} />
          <p className="font-semibold">Relancer le débit de {amountLabel} ?</p>
          <p className="text-sm text-graphite">
            Stripe est d’abord vérifié : si un paiement a déjà réussi, la réservation est simplement
            confirmée, sans nouveau débit. Sinon la carte enregistrée est débitée de ce montant
            figé. L’action est tracée à votre nom.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Confirmer la relance</Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : allowed ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(true)}>
            Relancer le débit
          </Button>
        </div>
      ) : null}
    </div>
  );
}
