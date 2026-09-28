"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

import { authErrorMessage } from "../_components/auth-errors";

export function VerifyForm() {
  const router = useRouter();
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setPending(true);
    setError("");

    const { error } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });

    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void onSubmit(event)} noValidate>
      {useBackupCode ? (
        <Field label="Code de secours" required error={error || undefined}>
          <Input key="backup" name="code" autoComplete="off" spellCheck={false} />
        </Field>
      ) : (
        <Field label="Code à 6 chiffres" required error={error || undefined}>
          <Input
            key="totp"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
          />
        </Field>
      )}
      <Button type="submit" loading={pending}>
        Valider
      </Button>
      <Button
        variant="quiet"
        onClick={() => {
          setUseBackupCode((value) => !value);
          setError("");
        }}
      >
        {useBackupCode
          ? "Utiliser l’application d’authentification"
          : "Utiliser un code de secours"}
      </Button>
    </form>
  );
}
