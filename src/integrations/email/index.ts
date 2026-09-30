import "server-only";

import { serverEnv } from "@/lib/env/server";

import { createResendEmailSender } from "./resend";
import type { EmailSender } from "./sender";

export { providerIdempotencyKey, RESEND_DEFAULTS } from "./resend";
export {
  EMAIL_ERROR_CODES,
  type EmailErrorCode,
  type EmailMessage,
  type EmailSender,
  type EmailSendResult,
} from "./sender";

let sender: EmailSender | undefined;

/**
 * Resend-backed sender, created on first use: neither import nor `next build` reads the
 * environment, and the key is read on each send. Without `RESEND_API_KEY` or `EMAIL_FROM`, a
 * send returns `EMAIL_NOT_CONFIGURED`. Tests pass their own `EmailSender` instead.
 */
export function emailSender(): EmailSender {
  sender ??= createResendEmailSender({
    apiKey: () => serverEnv().RESEND_API_KEY,
    from: () => serverEnv().EMAIL_FROM,
    replyTo: () => serverEnv().EMAIL_REPLY_TO,
  });
  return sender;
}
