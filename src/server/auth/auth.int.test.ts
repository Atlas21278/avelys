import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { BACK_OFFICE_ROLES, type StaffRole } from "@/domain/auth/access";
import { db } from "@/server/db";
import { totpFromUri } from "@/test/totp";

import { checkAccess } from "./access";
import { AUTH_BASE_PATH, auth, warnIfNoTrustedProxies } from "./auth";
import { createStaffUser, StaffUserExistsError } from "./staff-users";

// Runs against the real test database (vitest "integration" project), migrations applied.

const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:3000";
// Stands in for the ingress: listed in TRUSTED_PROXIES by vitest.config.ts (198.51.100.0/24).
const INGRESS = "198.51.100.10";

/** Minimal browser-like cookie jar fed by Set-Cookie headers. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  headers(): Headers {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    return new Headers(cookie ? { cookie } : {});
  }
}

async function staff(role: StaffRole, email = `${role.toLowerCase()}@avelys.test`) {
  await createStaffUser({ email, name: `Test ${role}`, role, password: PASSWORD });
  return email;
}

async function signIn(email: string, jar = new CookieJar()) {
  const { headers, response } = await auth().api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  jar.store(headers);
  return { jar, response };
}

/** Enrols TOTP the way the setup page does: enable with the password, then confirm a code. */
async function enrolTotp(jar: CookieJar) {
  const enabled = await auth().api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: jar.headers(),
  });
  if (!("totpURI" in enabled) || !enabled.totpURI) throw new Error("TOTP enrolment failed.");
  const { headers } = await auth().api.verifyTOTP({
    body: { code: totpFromUri(enabled.totpURI) },
    headers: jar.headers(),
    returnHeaders: true,
  });
  jar.store(headers);
  return enabled.totpURI;
}

function post(path: string, body: unknown, ip: string): Promise<Response> {
  return auth().handler(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

describe("back-office authentication (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.session.deleteMany();
    await client.account.deleteMany();
    await client.twoFactor.deleteMany();
    await client.verification.deleteMany();
    await client.rateLimit.deleteMany();
    await client.user.deleteMany();
  });

  afterAll(async () => {
    await db().$disconnect();
  });

  it("refuses access without a session", async () => {
    await expect(checkAccess(new Headers(), BACK_OFFICE_ROLES)).resolves.toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("refuses a signed-in user whose role is not allowed (DRIVER)", async () => {
    const { jar } = await signIn(await staff("DRIVER"));
    await expect(checkAccess(jar.headers(), BACK_OFFICE_ROLES)).resolves.toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
  });

  it("refuses an ADMIN and a DISPATCHER who have not enrolled 2FA", async () => {
    for (const role of ["ADMIN", "DISPATCHER"] as const) {
      const { jar } = await signIn(await staff(role));
      await expect(checkAccess(jar.headers(), BACK_OFFICE_ROLES)).resolves.toEqual({
        ok: false,
        reason: "TWO_FACTOR_REQUIRED",
      });
    }
  });

  it("grants access once TOTP is enrolled and verified", async () => {
    const { jar } = await signIn(await staff("DISPATCHER"));
    await enrolTotp(jar);

    const result = await checkAccess(jar.headers(), BACK_OFFICE_ROLES);
    expect(result).toMatchObject({ ok: true, user: { role: "DISPATCHER" } });
    // ADMIN-only areas stay closed to a dispatcher.
    await expect(checkAccess(jar.headers(), ["ADMIN"])).resolves.toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
  });

  it("refuses access after sign-out, even with the old cookie", async () => {
    const { jar } = await signIn(await staff("ADMIN"));
    await enrolTotp(jar);
    const before = jar.headers();
    await expect(checkAccess(before, BACK_OFFICE_ROLES)).resolves.toMatchObject({ ok: true });

    await auth().api.signOut({ headers: before });

    await expect(checkAccess(before, BACK_OFFICE_ROLES)).resolves.toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("opens no session on the password alone once 2FA is enrolled", async () => {
    const email = await staff("ADMIN");
    const first = await signIn(email);
    const totpURI = await enrolTotp(first.jar);
    await auth().api.signOut({ headers: first.jar.headers() });

    const second = await signIn(email);
    expect(second.response).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    await expect(checkAccess(second.jar.headers(), BACK_OFFICE_ROLES)).resolves.toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });

    // A wrong code is rejected and still opens nothing.
    await expect(
      auth().api.verifyTOTP({ body: { code: "000000" }, headers: second.jar.headers() }),
    ).rejects.toThrow();

    const { headers } = await auth().api.verifyTOTP({
      body: { code: totpFromUri(totpURI) },
      headers: second.jar.headers(),
      returnHeaders: true,
    });
    second.jar.store(headers);
    await expect(checkAccess(second.jar.headers(), BACK_OFFICE_ROLES)).resolves.toMatchObject({
      ok: true,
      user: { role: "ADMIN" },
    });
  });

  it("refuses to disable 2FA and to trust a device", async () => {
    const email = await staff("ADMIN");
    const { jar } = await signIn(email);
    const totpURI = await enrolTotp(jar);

    await expect(
      auth().api.disableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers() }),
    ).rejects.toMatchObject({ body: { code: "TWO_FACTOR_MANDATORY" } });
    await expect(checkAccess(jar.headers(), BACK_OFFICE_ROLES)).resolves.toMatchObject({
      ok: true,
    });

    await expect(
      auth().api.verifyTOTP({
        body: { code: "123456", trustDevice: true },
        headers: jar.headers(),
      }),
    ).rejects.toMatchObject({ body: { code: "TRUST_DEVICE_NOT_ALLOWED" } });

    // Refused even with a valid code during a sign-in challenge: no session is opened.
    await auth().api.signOut({ headers: jar.headers() });
    const challenge = await signIn(email);
    await expect(
      auth().api.verifyTOTP({
        body: { code: totpFromUri(totpURI), trustDevice: true },
        headers: challenge.jar.headers(),
      }),
    ).rejects.toMatchObject({ body: { code: "TRUST_DEVICE_NOT_ALLOWED" } });
    await expect(checkAccess(challenge.jar.headers(), BACK_OFFICE_ROLES)).resolves.toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("locks TOTP verification after 10 consecutive wrong codes, even with a valid code", async () => {
    const email = await staff("ADMIN");
    const first = await signIn(email);
    const totpURI = await enrolTotp(first.jar);
    await auth().api.signOut({ headers: first.jar.headers() });

    // Each sign-in challenge allows 5 attempts; the account budget (10) spans challenges.
    for (let challenge = 0; challenge < 2; challenge += 1) {
      const { jar } = await signIn(email);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          auth().api.verifyTOTP({ body: { code: "000000" }, headers: jar.headers() }),
        ).rejects.toMatchObject({ body: { code: "INVALID_CODE" } });
      }
    }

    const locked = await db().twoFactor.findFirstOrThrow({ where: { user: { email } } });
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const { jar } = await signIn(email);
    await expect(
      auth().api.verifyTOTP({ body: { code: totpFromUri(totpURI) }, headers: jar.headers() }),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_TEMPORARILY_LOCKED" } });
    await expect(checkAccess(jar.headers(), BACK_OFFICE_ROLES)).resolves.toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("gives sessions the configured lifetime (AUTH_SESSION_MAX_AGE_SECONDS, default 7 days)", async () => {
    const before = Date.now();
    await signIn(await staff("DRIVER"));
    const session = await db().session.findFirstOrThrow();
    const lifetime = session.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThan(604_800_000 - 60_000);
    expect(lifetime).toBeLessThanOrEqual(604_800_000 + 60_000);
  });

  it("never lets a user change their own role", async () => {
    const email = await staff("DRIVER");
    const { jar } = await signIn(email);

    await auth()
      .api.updateUser({ body: { role: "ADMIN" } as never, headers: jar.headers() })
      .catch(() => undefined);

    const user = await db().user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("DRIVER");
  });

  it("has no public sign-up", async () => {
    const response = await post(
      "/sign-up/email",
      { email: "intruder@avelys.test", password: PASSWORD, name: "Intruder" },
      "192.0.2.1",
    );
    expect(response.ok).toBe(false);
    await expect(db().user.count({ where: { email: "intruder@avelys.test" } })).resolves.toBe(0);
  });

  it("rate limits sign-in attempts per client IP", async () => {
    await staff("ADMIN");
    const attempt = (ip: string) =>
      post("/sign-in/email", { email: "admin@avelys.test", password: "wrong password!" }, ip);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await attempt("203.0.113.7")).status);
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);

    // Another client is not affected.
    expect((await attempt("203.0.113.8")).status).not.toBe(429);
  });

  it("keys the rate limit on the real client IP, not on a spoofed X-Forwarded-For entry", async () => {
    await staff("ADMIN");
    // The client forges the leftmost entries; the ingress appends the address it saw.
    const attempt = (spoofed: string, client: string) =>
      post(
        "/sign-in/email",
        { email: "admin@avelys.test", password: "wrong password!" },
        `${spoofed}, ${client}, ${INGRESS}`,
      );

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await attempt(`192.0.2.${100 + i}`, "203.0.113.20")).status);
    }
    expect(statuses.slice(0, 3)).not.toContain(429);
    // A new spoofed address on each request does not reset the real client's budget.
    expect(statuses[3]).toBe(429);

    const keys = (await db().rateLimit.findMany({ select: { key: true } })).map((row) => row.key);
    expect(keys.some((key) => key.startsWith("203.0.113.20|"))).toBe(true);
    expect(keys.some((key) => key.startsWith("192.0.2."))).toBe(false);
    expect(keys.some((key) => key.startsWith("no-trusted-ip"))).toBe(false);

    // Another real client behind the same ingress keeps its own budget.
    expect((await attempt("192.0.2.200", "203.0.113.21")).status).not.toBe(429);
  });

  it("warns when TRUSTED_PROXIES is empty in production only", () => {
    expect(warnIfNoTrustedProxies("production", [])).toBe(true);
    expect(warnIfNoTrustedProxies("production", ["10.0.0.0/8"])).toBe(false);
    expect(warnIfNoTrustedProxies("staging", [])).toBe(false);
  });

  it("creates staff accounts only with a valid role, a long password and a unique email", async () => {
    await staff("ADMIN");
    await expect(staff("ADMIN")).rejects.toBeInstanceOf(StaffUserExistsError);
    await expect(
      createStaffUser({ email: "a@avelys.test", name: "A", role: "ADMIN", password: "short" }),
    ).rejects.toThrow();
    await expect(
      createStaffUser({
        email: "c@avelys.test",
        name: "C",
        role: "CUSTOMER" as never,
        password: PASSWORD,
      }),
    ).rejects.toThrow();

    // Concurrent creations: the unique index decides, reported as the same domain error.
    const results = await Promise.allSettled([staff("DISPATCHER"), staff("DISPATCHER")]);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(StaffUserExistsError);

    // The password is stored hashed, never in clear.
    const account = await db().account.findFirstOrThrow({ where: { providerId: "credential" } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
  });
});
