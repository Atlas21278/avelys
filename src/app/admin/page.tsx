import { requireBackOfficeUser } from "@/server/auth/back-office";

import { SignOutButton } from "./_components/sign-out-button";

export const dynamic = "force-dynamic";

const ROLE_LABELS = {
  ADMIN: "Administrateur",
  DISPATCHER: "Dispatch",
  DRIVER: "Chauffeur",
  CUSTOMER: "Client",
} as const;

export default async function AdminHome() {
  const user = await requireBackOfficeUser();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="small-caps-label text-graphite">Back-office</p>
        <h1 className="font-display-optical text-display-sm">Bonjour, {user.name}</h1>
        <p className="text-graphite">Rôle : {ROLE_LABELS[user.role]}</p>
      </header>
      <p>Les écrans d’exploitation arrivent avec les prochains tickets.</p>
      <SignOutButton />
    </div>
  );
}
