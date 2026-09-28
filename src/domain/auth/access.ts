/**
 * Access rules for authenticated areas (ADR-0005, DEC-15). Pure: the caller loads the
 * session; this module only decides. Unknown values fail closed.
 */

export const ROLES = ["ADMIN", "DISPATCHER", "DRIVER", "CUSTOMER"] as const;
export type Role = (typeof ROLES)[number];

/** Roles that sign in with email + password (customers use magic links, EPIC-13). */
export const STAFF_ROLES = ["ADMIN", "DISPATCHER", "DRIVER"] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles allowed into the back-office (/admin). */
export const BACK_OFFICE_ROLES = ["ADMIN", "DISPATCHER"] as const satisfies readonly Role[];

/** TOTP is mandatory for these roles: ADMIN (ADR-0005) and DISPATCHER (DEC-15, decided 2026-09-28). */
export const TWO_FACTOR_REQUIRED_ROLES = ["ADMIN", "DISPATCHER"] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function requiresTwoFactor(role: Role): boolean {
  return (TWO_FACTOR_REQUIRED_ROLES as readonly Role[]).includes(role);
}

export type AccessDenialReason = "UNAUTHENTICATED" | "FORBIDDEN" | "TWO_FACTOR_REQUIRED";

export type AccessDecision =
  | { readonly ok: true; readonly role: Role }
  | { readonly ok: false; readonly reason: AccessDenialReason };

/** The subset of the session user that access decisions depend on. */
export interface AccessSubject {
  readonly role?: unknown;
  readonly twoFactorEnabled?: boolean | null;
}

/**
 * Decides access for a session user. The role is checked before 2FA so that a user who
 * could never enter is refused outright instead of being asked to enrol an authenticator.
 */
export function evaluateAccess(
  subject: AccessSubject | null,
  allowedRoles: readonly Role[],
): AccessDecision {
  if (!subject) return { ok: false, reason: "UNAUTHENTICATED" };

  const { role } = subject;
  if (!isRole(role) || !allowedRoles.includes(role)) return { ok: false, reason: "FORBIDDEN" };

  if (requiresTwoFactor(role) && subject.twoFactorEnabled !== true) {
    return { ok: false, reason: "TWO_FACTOR_REQUIRED" };
  }
  return { ok: true, role };
}
