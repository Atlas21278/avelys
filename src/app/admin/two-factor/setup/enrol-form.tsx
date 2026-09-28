"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

import { authErrorMessage } from "../../_components/auth-errors";

type Enrolment = { secret: string; totpURI: string; backupCodes: string[] };

function groupsOfFour(value: string): string {
  return value.match(/.{1,4}/g)?.join(" ") ?? value;
}

export function EnrolForm() {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError("");

    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !("totpURI" in data) || !data.totpURI) {
      setError(authErrorMessage(error ?? {}));
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setEnrolment({ secret, totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setPending(true);
    setError("");

    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  if (!enrolment) {
    return (
      <form className="flex flex-col gap-6" onSubmit={(event) => void start(event)} noValidate>
        <Field
          label="Mot de passe"
          hint="Confirmez votre mot de passe pour générer la clé."
          required
          error={error || undefined}
        >
          <Input name="password" type="password" autoComplete="current-password" />
        </Field>
        <Button type="submit" loading={pending}>
          Générer la clé
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="small-caps-label text-graphite">1. Ajoutez la clé à votre application</h2>
        <p>Saisie manuelle, type « basé sur le temps », 6 chiffres :</p>
        <p className="font-mono text-lg break-all select-all">{groupsOfFour(enrolment.secret)}</p>
        <a className="underline underline-offset-4" href={enrolment.totpURI}>
          Ouvrir dans l’application d’authentification de cet appareil
        </a>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="small-caps-label text-graphite">2. Conservez vos codes de secours</h2>
        <p>
          Chaque code ne sert qu’une fois, si le téléphone est perdu. Ils ne seront plus affichés.
        </p>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono select-all">
          {enrolment.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </section>

      <form className="flex flex-col gap-6" onSubmit={(event) => void confirm(event)} noValidate>
        <h2 className="small-caps-label text-graphite">3. Confirmez avec un code</h2>
        <Field label="Code à 6 chiffres" required error={error || undefined}>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
          />
        </Field>
        <Button type="submit" loading={pending}>
          Activer et continuer
        </Button>
      </form>
    </div>
  );
}
