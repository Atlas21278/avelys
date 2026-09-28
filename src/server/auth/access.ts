import "server-only";

import {
  type AccessDecision,
  evaluateAccess,
  type Role,
  type StaffRole,
} from "@/domain/auth/access";

import { auth } from "./auth";

export interface StaffIdentity {
  readonly userId: string;
  readonly role: Role;
  readonly name: string;
}

export type AccessResult =
  { readonly ok: true; readonly user: StaffIdentity } | Extract<AccessDecision, { ok: false }>;

/**
 * Server-side authorization for a request (ADR-0005): loads the session from PostgreSQL
 * through Better Auth, then applies the pure access rules (role, then mandatory 2FA).
 * Call it from every page, server action and route handler that needs a role: a check in
 * a layout or in Proxy alone is not enough.
 */
export async function checkAccess(
  headers: Headers,
  allowedRoles: readonly StaffRole[],
): Promise<AccessResult> {
  const session = await auth().api.getSession({ headers });
  if (!session) return { ok: false, reason: "UNAUTHENTICATED" };

  const { user } = session;
  const decision = evaluateAccess(user, allowedRoles);
  if (!decision.ok) return decision;
  return { ok: true, user: { userId: user.id, role: decision.role, name: user.name } };
}
