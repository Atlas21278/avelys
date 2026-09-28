import { requirePendingTwoFactorEnrolment } from "@/server/auth/back-office";

import { AuthHeading } from "../../_components/auth-heading";
import { EnrolForm } from "./enrol-form";

export const dynamic = "force-dynamic";

export default async function AdminTwoFactorSetup() {
  await requirePendingTwoFactorEnrolment();

  return (
    <div className="flex flex-col gap-10">
      <AuthHeading title="Activer la double authentification">
        Obligatoire pour accéder au back-office. Munissez-vous d’une application d’authentification
        (par exemple celle de votre gestionnaire de mots de passe).
      </AuthHeading>
      <EnrolForm />
    </div>
  );
}
