"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

import { authErrorMessage } from "../_components/auth-errors";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");

    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    // 2FA enrolled: the password alone opens no session, the code is asked next.
    // Not enrolled yet: /admin sends the user to the enrolment page.
    const next = data && "twoFactorRedirect" in data ? "/admin/two-factor" : "/admin";
    router.replace(next);
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void onSubmit(event)} noValidate>
      <Field label="Email" required>
        <Input name="email" type="email" autoComplete="username" inputMode="email" />
      </Field>
      <Field label="Mot de passe" required error={error || undefined}>
        <Input name="password" type="password" autoComplete="current-password" />
      </Field>
      <Button type="submit" loading={pending}>
        Se connecter
      </Button>
    </form>
  );
}
