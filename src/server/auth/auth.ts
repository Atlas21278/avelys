import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";

import { ROLES } from "@/domain/auth/access";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

/** Mount point of the Better Auth route handler (src/app/api/auth/[...all]/route.ts). */
export const AUTH_BASE_PATH = "/api/auth";

/** Minimum length of a staff password (security policy, configurable here). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Better Auth configuration (ADR-0005, docs/architecture/security.md).
 *
 * - Sessions in PostgreSQL (Prisma adapter); no cookie cache, so a sign-out or a revoked
 *   session is effective on the next request.
 * - Email + password for staff; public sign-up is disabled: accounts are created by the
 *   local script (`pnpm auth:create-staff`).
 * - TOTP two-factor. Whether it is mandatory is a role rule enforced by the server guard
 *   (src/server/auth/access.ts); disabling it and "trusted devices" are refused here.
 * - Rate limiting on every auth endpoint, stored in the database so it holds across replicas.
 */
function createAuth() {
  const env = serverEnv();

  return betterAuth({
    appName: "Avelys",
    baseURL: env.APP_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    user: {
      additionalFields: {
        role: {
          type: [...ROLES],
          required: false,
          defaultValue: "CUSTOMER",
          // Never settable from a request: roles are assigned server-side only.
          input: false,
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
    },
    advanced: {
      cookiePrefix: "avelys",
    },
    logger: {
      // Structured logs through pino; the message only, extra arguments may carry user data.
      log: (level, message) => {
        logger()[level]({ source: "better-auth" }, message);
      },
    },
    plugins: [twoFactor({ issuer: "Avelys" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // 2FA is mandatory for back-office roles (ADR-0005, DEC-15): it cannot be switched off,
        // and a device cannot be "trusted" to skip the second factor on the next sign-in.
        if (ctx.path === "/two-factor/disable") {
          throw new APIError("FORBIDDEN", {
            code: "TWO_FACTOR_MANDATORY",
            message: "Two-factor authentication cannot be disabled.",
          });
        }
        const body: unknown = ctx.body;
        if (
          ctx.path.startsWith("/two-factor/") &&
          typeof body === "object" &&
          body !== null &&
          "trustDevice" in body &&
          body.trustDevice
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "TRUST_DEVICE_NOT_ALLOWED",
            message: "Trusted devices are not allowed.",
          });
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { auth?: Auth };

/**
 * One Better Auth instance per process, created on first use: `next build` imports route
 * modules without runtime variables, and the environment is validated only when needed.
 */
export function auth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}
