import "server-only";

import pino from "pino";

import { serverEnv } from "./env/server";
import { currentCorrelationId } from "./request-context";

/**
 * Structured JSON logs on stdout (docs/architecture/observability.md).
 * Personal data and secrets are redacted by key; log a bookingRef, never a name or an email.
 */
export const REDACTED_PATHS = [
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.secret",
  "*.email",
  "*.phone",
  "*.cardNumber",
  "*.DATABASE_URL",
  "*.BETTER_AUTH_SECRET",
  "*.backupCodes",
  "*.totpURI",
  "req.headers.authorization",
  "req.headers.cookie",
];

let instance: pino.Logger | undefined;

function baseLogger(): pino.Logger {
  if (!instance) {
    const env = serverEnv();
    instance = pino({
      level: env.LOG_LEVEL,
      base: { env: env.APP_ENV, release: process.env.APP_RELEASE ?? "dev" },
      redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin: () => {
        const correlationId = currentCorrelationId();
        return correlationId ? { correlationId } : {};
      },
    });
  }
  return instance;
}

export function logger(): pino.Logger {
  return baseLogger();
}
