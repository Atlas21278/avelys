import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { requireBackOfficeUser } from "@/server/auth/back-office";

import { AdminNav } from "./_components/admin-nav";
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
    <>
      <AdminNav current="home" />
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display-optical text-display-sm">Bonjour, {user.name}</h1>
          <p className="text-graphite">Rôle : {ROLE_LABELS[user.role]}</p>
        </header>
        <Link href="/admin/reservations" className={buttonClasses("primary")}>
          Voir les réservations
        </Link>
        <SignOutButton />
      </div>
    </>
  );
}
