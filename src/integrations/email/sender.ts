/**
 * Transactional email port (VTC-043, ADR-0011). The notification service depends on this
 * interface only; the Resend implementation lives in `./resend.ts` and tests pass a fake.
 * A sender never throws: every failure comes back as a technical code, never as a provider
 * message (which may quote an address, BR-60).
 */

export interface EmailMessage {
  /** Recipient address. Never logged, never stored. */
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /**
   * Sent as the provider `Idempotency-Key`: a retry with the same key is not delivered twice
   * (Resend keeps keys for 24 hours).
   */
  readonly idempotencyKey: string;
}

export const EMAIL_ERROR_CODES = [
  /** No API key or no sender address configured. */
  "EMAIL_NOT_CONFIGURED",
  /** No answer within the adapter timeout. The email may still have been accepted. */
  "EMAIL_TIMEOUT",
  /** The provider could not be reached. */
  "EMAIL_NETWORK_ERROR",
  /** Missing, invalid or restricted API key. */
  "EMAIL_AUTH_FAILED",
  /** The message was refused (invalid field, sender or recipient). */
  "EMAIL_REJECTED",
  /** Rate limit or sending quota reached. */
  "EMAIL_RATE_LIMITED",
  /** Same idempotency key sent with another payload, or still being processed. */
  "EMAIL_IDEMPOTENCY_CONFLICT",
  /** Any other provider error or an unexpected answer. */
  "EMAIL_PROVIDER_ERROR",
] as const;

export type EmailErrorCode = (typeof EMAIL_ERROR_CODES)[number];

export type EmailSendResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly code: EmailErrorCode };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
