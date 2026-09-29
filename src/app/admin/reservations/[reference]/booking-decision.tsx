"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { acceptBookingAction, type DecisionState, refuseBookingAction } from "./actions";

type Decision = "ACCEPTED" | "REFUSED";

const COPY = {
  ACCEPTED: {
    button: "Accepter",
    question: "Accepter cette demande ?",
    detail: "La réservation passe au statut « Acceptée ». L’action est tracée à votre nom.",
    confirm: "Confirmer l’acceptation",
    done: "Demande acceptée.",
  },
  REFUSED: {
    button: "Refuser",
    question: "Refuser cette demande ?",
    detail:
      "Aucun montant n’est débité : le moyen de paiement enregistré n’est pas utilisé. Le refus est définitif et tracé à votre nom.",
    confirm: "Confirmer le refus",
    done: "Demande refusée.",
  },
} as const satisfies Record<Decision, Record<string, string>>;

interface BookingDecisionProps {
  reference: string;
  version: number;
  /** Decisions the server allows for this status and role (`allowedTransitions`). */
  allowed: readonly Decision[];
}

/**
 * Accept / refuse buttons of a `REQUESTED` booking, each behind an explicit confirmation. The
 * server re-checks everything: these buttons are a convenience, not a permission. The component
 * stays mounted when no decision is allowed any more, so that the outcome of the last action
 * (success or conflict) remains visible after the page refresh that follows it.
 */
export function BookingDecision({ reference, version, allowed }: BookingDecisionProps) {
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [submitted, setSubmitted] = useState<Decision | null>(null);
  const [acceptState, accept, accepting] = useActionState<DecisionState, FormData>(
    acceptBookingAction,
    null,
  );
  const [refuseState, refuse, refusing] = useActionState<DecisionState, FormData>(
    refuseBookingAction,
    null,
  );
  const pending = accepting || refusing;
  const outcome =
    submitted === "ACCEPTED" ? acceptState : submitted === "REFUSED" ? refuseState : null;
  const open = confirming !== null && allowed.includes(confirming) ? confirming : null;

  if (allowed.length === 0 && !outcome && !pending) return null;

  return (
    <div className="flex flex-col gap-4">
      {pending ? <p role="status">Enregistrement…</p> : null}
      {!pending && outcome && !outcome.ok ? (
        <p role="alert" className="border-l-2 border-rubric pl-3 text-rubric">
          {outcome.error.message}{" "}
          <span className="text-sm text-graphite">
            (référence incident : {outcome.error.correlationId})
          </span>
        </p>
      ) : null}
      {!pending && outcome?.ok ? <p role="status">{COPY[outcome.status].done}</p> : null}

      {open ? (
        <form
          action={open === "ACCEPTED" ? accept : refuse}
          onSubmit={() => {
            setSubmitted(open);
            setConfirming(null);
          }}
          className="flex flex-col gap-3 border border-hairline p-4"
        >
          <input type="hidden" name="reference" value={reference} />
          <input type="hidden" name="expectedVersion" value={version} />
          <p className="font-semibold">{COPY[open].question}</p>
          <p className="text-sm text-graphite">{COPY[open].detail}</p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">{COPY[open].confirm}</Button>
            <Button variant="quiet" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : allowed.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {allowed.map((decision) => (
            <Button
              key={decision}
              variant={decision === "ACCEPTED" ? "primary" : "secondary"}
              disabled={pending}
              onClick={() => setConfirming(decision)}
            >
              {COPY[decision].button}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
