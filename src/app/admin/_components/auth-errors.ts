/** French messages for Better Auth errors; never echoes server details. */
export function authErrorMessage(error: { status?: number; code?: string } | null): string {
  if (!error) return "";
  if (error.status === 429)
    return "Trop de tentatives. Patientez quelques secondes puis réessayez.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
      return "Email ou mot de passe incorrect.";
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
      return "Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.";
    case "INVALID_TWO_FACTOR_COOKIE":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "La vérification a expiré. Reconnectez-vous.";
    case "ACCOUNT_TEMPORARILY_LOCKED":
      return "Trop de codes incorrects : compte bloqué temporairement. Réessayez plus tard.";
    default:
      return "La demande n’a pas abouti. Réessayez.";
  }
}
