"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    // The session row is deleted server-side: the cookie becomes useless even if kept.
    await authClient.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <Button variant="secondary" loading={pending} onClick={() => void signOut()}>
      Se déconnecter
    </Button>
  );
}
