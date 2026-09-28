import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { BACK_OFFICE_ROLES, type StaffRole } from "@/domain/auth/access";

import { checkAccess, type StaffIdentity } from "./access";

export const BACK_OFFICE_PATHS = {
  home: "/admin",
  login: "/admin/login",
  twoFactor: "/admin/two-factor",
  twoFactorSetup: "/admin/two-factor/setup",
} as const;

/**
 * Guard for back-office pages: call it at the top of every page (not only in a layout,
 * which does not re-render on client navigation). No session: sign-in page. Role
 * outside the list: 404, so the back-office does not reveal itself. Role allowed but
 * 2FA not enrolled: enrolment page.
 */
export async function requireBackOfficeUser(
  allowedRoles: readonly StaffRole[] = BACK_OFFICE_ROLES,
): Promise<StaffIdentity> {
  const result = await checkAccess(await headers(), allowedRoles);
  if (result.ok) return result.user;

  switch (result.reason) {
    case "UNAUTHENTICATED":
      redirect(BACK_OFFICE_PATHS.login);
    case "FORBIDDEN":
      notFound();
    case "TWO_FACTOR_REQUIRED":
      redirect(BACK_OFFICE_PATHS.twoFactorSetup);
  }
}

/**
 * Guard for the 2FA enrolment page: only a signed-in back-office user who has not
 * enrolled yet may see it.
 */
export async function requirePendingTwoFactorEnrolment(): Promise<void> {
  const result = await checkAccess(await headers(), BACK_OFFICE_ROLES);
  if (result.ok) redirect(BACK_OFFICE_PATHS.home);

  switch (result.reason) {
    case "UNAUTHENTICATED":
      redirect(BACK_OFFICE_PATHS.login);
    case "FORBIDDEN":
      notFound();
    case "TWO_FACTOR_REQUIRED":
      return;
  }
}
