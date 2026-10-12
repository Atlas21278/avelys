"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

/**
 * « Copier le lien de régularisation » (VTC-042): copies the signed link of a `REQUIRES_ACTION`
 * payment, to send it to the customer by hand when the email (VTC-044) did not reach them. The
 * link is computed by the server for `ADMIN` only; it is never logged. Without clipboard access,
 * the link stays selectable in the field.
 */
export function CopyRegularizationLink({ url }: { url: string }) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-hairline p-4">
      <p className="font-semibold">Authentification du client requise</p>
      <p className="text-sm text-graphite">
        La banque demande une authentification (SCA). Le client la valide lui-même avec ce lien,
        sans nouvelle carte ni changement de montant ; la réservation est confirmée par le webhook
        Stripe. Le lien ne vaut que pour la tentative en cours, tant que le paiement attend et avant
        la prise en charge.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-graphite">Lien de régularisation</span>
        <input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full border-b border-rule bg-transparent py-1 font-mono text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={() => void copy()}>
          Copier le lien de régularisation
        </Button>
        <p role="status" className="text-sm">
          {state === "copied" ? "Lien copié." : null}
          {state === "failed" ? "Copie impossible : sélectionnez le lien ci-dessus." : null}
        </p>
      </div>
    </div>
  );
}
