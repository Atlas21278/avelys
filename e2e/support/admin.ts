/**
 * ADMIN account of the end-to-end suite (VTC-048): created on each run by
 * `e2e/support/seed-admin.ts`, on the E2E database only. The password is the fixed test value of
 * the integration helpers (`src/test/staff-session.ts`), not a secret.
 */
export const E2E_ADMIN = {
  email: "admin@e2e.avelys.test",
  password: "correct horse battery staple",
} as const;

/** Environment variable through which the global setup hands the otpauth URI to the tests. */
export const ADMIN_TOTP_URI_VARIABLE = "E2E_ADMIN_TOTP_URI";
