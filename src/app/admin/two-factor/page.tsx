import { AuthHeading } from "../_components/auth-heading";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

// Second step of the sign-in. No session exists yet: the pending challenge lives in a signed,
// short-lived cookie that only the Better Auth verification endpoints accept.
export default function AdminTwoFactor() {
  return (
    <div className="flex flex-col gap-10">
      <AuthHeading title="Vérification">
        Saisissez le code à 6 chiffres affiché par votre application d’authentification.
      </AuthHeading>
      <VerifyForm />
    </div>
  );
}
