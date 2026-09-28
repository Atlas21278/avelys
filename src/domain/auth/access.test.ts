import { describe, expect, it } from "vitest";

import {
  BACK_OFFICE_ROLES,
  evaluateAccess,
  isRole,
  requiresTwoFactor,
  STAFF_ROLES,
  TWO_FACTOR_REQUIRED_ROLES,
} from "./access";

describe("roles", () => {
  it("recognises exactly the four roles of ADR-0005", () => {
    for (const role of ["ADMIN", "DISPATCHER", "DRIVER", "CUSTOMER"]) {
      expect(isRole(role)).toBe(true);
    }
    for (const value of ["admin", "USER", "", null, undefined, 1]) {
      expect(isRole(value)).toBe(false);
    }
  });

  it("requires 2FA for ADMIN and DISPATCHER (ADR-0005, DEC-15), not for the others", () => {
    expect(TWO_FACTOR_REQUIRED_ROLES).toEqual(["ADMIN", "DISPATCHER"]);
    expect(requiresTwoFactor("ADMIN")).toBe(true);
    expect(requiresTwoFactor("DISPATCHER")).toBe(true);
    expect(requiresTwoFactor("DRIVER")).toBe(false);
    expect(requiresTwoFactor("CUSTOMER")).toBe(false);
  });

  it("lists the staff roles (password accounts) and the back-office roles", () => {
    expect(STAFF_ROLES).toEqual(["ADMIN", "DISPATCHER", "DRIVER"]);
    expect(BACK_OFFICE_ROLES).toEqual(["ADMIN", "DISPATCHER"]);
  });
});

describe("evaluateAccess", () => {
  const adminWith2fa = { role: "ADMIN", twoFactorEnabled: true };

  it("refuses without a session", () => {
    expect(evaluateAccess(null, BACK_OFFICE_ROLES)).toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("grants an allowed role with 2FA", () => {
    expect(evaluateAccess(adminWith2fa, BACK_OFFICE_ROLES)).toEqual({ ok: true, role: "ADMIN" });
    expect(
      evaluateAccess({ role: "DISPATCHER", twoFactorEnabled: true }, BACK_OFFICE_ROLES),
    ).toEqual({ ok: true, role: "DISPATCHER" });
  });

  it("refuses a role that is not allowed, even with 2FA", () => {
    expect(evaluateAccess({ role: "DRIVER", twoFactorEnabled: true }, BACK_OFFICE_ROLES)).toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
    expect(evaluateAccess({ role: "CUSTOMER", twoFactorEnabled: true }, ["ADMIN"])).toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
    expect(evaluateAccess({ role: "DISPATCHER", twoFactorEnabled: true }, ["ADMIN"])).toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
  });

  it("refuses an unknown or missing role (fail closed)", () => {
    for (const role of [undefined, null, "", "admin", "SUPERUSER"]) {
      expect(evaluateAccess({ role, twoFactorEnabled: true }, BACK_OFFICE_ROLES)).toEqual({
        ok: false,
        reason: "FORBIDDEN",
      });
    }
  });

  it("requires 2FA for ADMIN and DISPATCHER", () => {
    for (const twoFactorEnabled of [false, null, undefined]) {
      expect(evaluateAccess({ role: "ADMIN", twoFactorEnabled }, BACK_OFFICE_ROLES)).toEqual({
        ok: false,
        reason: "TWO_FACTOR_REQUIRED",
      });
      expect(evaluateAccess({ role: "DISPATCHER", twoFactorEnabled }, BACK_OFFICE_ROLES)).toEqual({
        ok: false,
        reason: "TWO_FACTOR_REQUIRED",
      });
    }
  });

  it("does not require 2FA for a role outside the 2FA list", () => {
    expect(evaluateAccess({ role: "DRIVER", twoFactorEnabled: false }, ["DRIVER"])).toEqual({
      ok: true,
      role: "DRIVER",
    });
  });

  it("checks the role before 2FA, so a forbidden user is never sent to 2FA setup", () => {
    expect(evaluateAccess({ role: "DRIVER", twoFactorEnabled: false }, BACK_OFFICE_ROLES)).toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
  });
});
