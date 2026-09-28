import type { StaffRole } from "@/domain/auth/access";
import { auth } from "@/server/auth/auth";
import { createStaffUser } from "@/server/auth/staff-users";

import { totpFromUri } from "./totp";

// Integration-test helpers: real Better Auth sessions against the test database.

/** Test-only password of every staff account created by these helpers. */
export const STAFF_PASSWORD = "correct horse battery staple";

/** Minimal browser-like cookie jar fed by Set-Cookie headers. */
export class CookieJar {
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

/** Creates a staff account and returns its email. */
export async function staff(role: StaffRole, email = `${role.toLowerCase()}@avelys.test`) {
  await createStaffUser({ email, name: `Test ${role}`, role, password: STAFF_PASSWORD });
  return email;
}

export async function signIn(email: string, jar = new CookieJar()) {
  const { headers, response } = await auth().api.signInEmail({
    body: { email, password: STAFF_PASSWORD },
    returnHeaders: true,
  });
  jar.store(headers);
  return { jar, response };
}

/** Enrols TOTP the way the setup page does: enable with the password, then confirm a code. */
export async function enrolTotp(jar: CookieJar) {
  const enabled = await auth().api.enableTwoFactor({
    body: { password: STAFF_PASSWORD },
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
