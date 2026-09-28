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
 * - Rate limiting on every auth endpoint, stored in the database so it holds across replicas,
 *   keyed by the client IP resolved through TRUSTED_PROXIES (see warnIfNoTrustedProxies).
 */
function createAuth() {
  const env = serverEnv();
  warnIfNoTrustedProxies(env.APP_ENV, env.TRUSTED_PROXIES);

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
    session: {
      // PROVISIONAL lifetime (AUTH_SESSION_MAX_AGE_SECONDS, default 7 days), pending a decision.
      expiresIn: env.AUTH_SESSION_MAX_AGE_SECONDS,
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
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        // X-Forwarded-For is read from the right, skipping these hops: the first untrusted
        // address is the client. Without them only a single-value header is believed.
        trustedProxies: env.TRUSTED_PROXIES,
      },
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

/**
 * Without trusted proxies, a multi-value or missing X-Forwarded-For resolves to no client IP
 * and every such request shares one rate-limit bucket per path (a sign-in lockout for all).
 * Deployed environments must set TRUSTED_PROXIES to the ingress hops (INFRA-005).
 */
export function warnIfNoTrustedProxies(appEnv: string, trustedProxies: readonly string[]): boolean {
  if (appEnv !== "production" || trustedProxies.length > 0) return false;
  logger().warn(
    { check: "auth-rate-limit", variable: "TRUSTED_PROXIES" },
    "TRUSTED_PROXIES is empty: auth rate limiting cannot identify clients behind a proxy",
  );
  return true;
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
