import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BACK_OFFICE_ROLES } from "@/domain/auth/access";
import { checkAccess } from "@/server/auth/access";

import { AuthHeading } from "../_components/auth-heading";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLogin() {
  const access = await checkAccess(await headers(), BACK_OFFICE_ROLES);
  if (access.ok) redirect("/admin");

  return (
    <div className="flex flex-col gap-10">
      <AuthHeading title="Connexion">
        Accès réservé à l’équipe. Les comptes sont créés par un administrateur.
      </AuthHeading>
      <LoginForm />
    </div>
  );
}
