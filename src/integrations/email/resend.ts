import { createHash } from "node:crypto";

import {
  Resend,
  type CreateEmailOptions,
  type CreateEmailRequestOptions,
  type CreateEmailResponse,
  type ErrorResponse,
} from "resend";

import { isEmailSender } from "./address";
import type { EmailErrorCode, EmailMessage, EmailSender, EmailSendResult } from "./sender";

/**
 * Resend adapter (VTC-043, ADR-0011). One attempt per call with a bounded timeout, no automatic
 * retry here: the notification service decides when to try again. The API key and every
 * provider message stay inside this module; callers only see a message id or a technical code.
 */

/** Technical default, configurable per instance. Not a business value. */
export const RESEND_DEFAULTS = { timeoutMs: 10_000 } as const;

/** The part of the Resend SDK the adapter uses: tests pass a fake, never the network. */
export interface ResendEmailsClient {
  emails: {
    send(
      payload: CreateEmailOptions,
      options?: CreateEmailRequestOptions,
    ): Promise<CreateEmailResponse>;
  };
}

export interface ResendSenderOptions {
  /** Read on each send so that a missing key fails at first use, never at build time. */
  apiKey: () => string | undefined;
  /** Sender, `address` or `Name <address>` (PROVISIONAL, DEC-01b). */
  from: () => string | undefined;
  replyTo?: () => string | undefined;
  timeoutMs?: number;
  /** Builds the SDK client for a key. Defaults to the real Resend client. */
  createClient?: (apiKey: string) => ResendEmailsClient;
}

/**
 * Real Resend client. The SDK prints every API error on `console.error` outside production, and
 * such a message may quote the recipient: that printer is silenced, the adapter maps the error
 * to a code instead (BR-60).
 */
export function createResendClient(apiKey: string): ResendEmailsClient {
  const client = new Resend(apiKey);
  Object.defineProperty(client, "logError", { value: () => undefined });
  return client;
}

/**
 * Provider idempotency key derived from the notification deduplication key: stable across
 * attempts, bounded in length (Resend accepts up to 256 characters) and free of the key's
 * content, which may carry identifiers.
 */
export function providerIdempotencyKey(dedupeKey: string): string {
  return `avelys-notification-${createHash("sha256").update(dedupeKey).digest("hex")}`;
}

const AUTH_ERRORS = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key"]);
const REJECTED_ERRORS = new Set([
  "validation_error",
  "invalid_parameter",
  "missing_required_field",
  "invalid_from_address",
  "invalid_attachment",
  "invalid_idempotency_key",
  "invalid_access",
  "invalid_region",
  "security_error",
]);
const RATE_ERRORS = new Set([
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);
const IDEMPOTENCY_ERRORS = new Set([
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
]);

/** Maps a Resend error to a technical code. The provider message is deliberately dropped. */
export function mapResendError(error: Pick<ErrorResponse, "name" | "statusCode">): EmailErrorCode {
  const name: string = error.name;
  if (AUTH_ERRORS.has(name)) return "EMAIL_AUTH_FAILED";
  if (REJECTED_ERRORS.has(name)) return "EMAIL_REJECTED";
  if (RATE_ERRORS.has(name)) return "EMAIL_RATE_LIMITED";
  if (IDEMPOTENCY_ERRORS.has(name)) return "EMAIL_IDEMPOTENCY_CONFLICT";
  // The SDK reports an unreachable API as an application_error without a status code.
  if (name === "application_error" && error.statusCode === null) return "EMAIL_NETWORK_ERROR";
  if (error.statusCode === 401 || error.statusCode === 403) return "EMAIL_AUTH_FAILED";
  if (error.statusCode === 429) return "EMAIL_RATE_LIMITED";
  return "EMAIL_PROVIDER_ERROR";
}

const TIMED_OUT = Symbol("timeout");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createResendEmailSender(options: ResendSenderOptions): EmailSender {
  const timeoutMs = options.timeoutMs ?? RESEND_DEFAULTS.timeoutMs;
  const createClient = options.createClient ?? createResendClient;
  let cached: { apiKey: string; client: ResendEmailsClient } | undefined;

  function clientFor(apiKey: string): ResendEmailsClient {
    if (cached?.apiKey !== apiKey) cached = { apiKey, client: createClient(apiKey) };
    return cached.client;
  }

  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const apiKey = options.apiKey();
      const from = options.from();
      if (!apiKey || !from || !isEmailSender(from))
        return { ok: false, code: "EMAIL_NOT_CONFIGURED" };
      const replyTo = options.replyTo?.();

      try {
        // The SDK does not take an abort signal: on timeout the request may still complete.
        // A later attempt reuses the idempotency key, so the email is not delivered twice.
        const response = await withTimeout(
          clientFor(apiKey).emails.send(
            {
              from,
              to: [message.to],
              subject: message.subject,
              html: message.html,
              text: message.text,
              ...(replyTo ? { replyTo } : {}),
            },
            { idempotencyKey: message.idempotencyKey },
          ),
          timeoutMs,
        );
        if (response === TIMED_OUT) return { ok: false, code: "EMAIL_TIMEOUT" };
        if (response.error) return { ok: false, code: mapResendError(response.error) };
        const messageId = response.data?.id;
        if (typeof messageId !== "string" || messageId === "") {
          return { ok: false, code: "EMAIL_PROVIDER_ERROR" };
        }
        return { ok: true, messageId };
      } catch {
        // The SDK catches its own errors; anything thrown here is unexpected, never propagated.
        return { ok: false, code: "EMAIL_PROVIDER_ERROR" };
      }
    },
  };
}
