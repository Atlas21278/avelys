import * as z from "zod";

import { PROVISIONAL_SERVICE_AREA, ServiceAreaSchema } from "@/domain/geo/service-area";
import { isEmailSender } from "@/integrations/email/address";
import {
  isTestModePublishableKey,
  isTestModeSecretKey,
  isWebhookSigningSecret,
} from "@/integrations/stripe/keys";

/** An empty value (as copied from .env.example) means "not configured". */
const optionalString = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * Server-side environment. Stripe, Maps and Resend variables come from their own tickets.
 * Public (NEXT_PUBLIC_*) variables will get a separate schema when the first one is needed:
 * Next.js only inlines them when referenced literally, so they cannot share this parser.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  APP_ENV: z.enum(["local", "ci", "staging", "production"]),
  APP_URL: z.url({ protocol: /^https?$/ }),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Signs and encrypts Better Auth cookies, tokens and TOTP secrets (VTC-016). At least 32 characters.
  BETTER_AUTH_SECRET: z.string().min(32),
  // Reverse proxies (IPs or CIDR ranges, comma-separated) whose X-Forwarded-For entries are
  // trusted when resolving the client IP for auth rate limiting. Empty by default; the ingress
  // topology is fixed by INFRA-005 (docs/architecture/security.md).
  TRUSTED_PROXIES: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),
  // Back-office session lifetime in seconds. PROVISIONAL: defaults to Better Auth's 7 days,
  // pending a decision (docs/architecture/security.md).
  // An empty value (as copied from .env.example) means "use the default".
  AUTH_SESSION_MAX_AGE_SECONDS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().default(604_800),
  ),
  // Stripe (VTC-030, ADR-0006), TEST MODE ONLY in every environment (BR-44): a live key or an
  // unrecognised format is refused here and again by the adapter. Optional so that `next build`
  // works without them; the adapter fails with a typed error on first use. Empty = not configured.
  STRIPE_SECRET_KEY: optionalString(z.string().refine(isTestModeSecretKey)),
  STRIPE_WEBHOOK_SECRET: optionalString(z.string().refine(isWebhookSigningSecret)),
  // Checked server-side only; the browser build will read it literally (Payment Element ticket).
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString(z.string().refine(isTestModePublishableKey)),
  // Google Maps Platform server key (VTC-024, ADR-0010): Routes API only, restricted by API and
  // IP. Optional at startup so that `next build` and pages without routing work without it;
  // the routing adapter fails with a typed error on first use when it is missing.
  // An empty value (as copied from .env.example) means "not configured".
  GOOGLE_MAPS_SERVER_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  // Resend (VTC-043, ADR-0011). All optional so that `next build` and every page work without
  // them: an email sent without the key or the sender is traced FAILED with EMAIL_NOT_CONFIGURED
  // and never affects the booking (BR-50). Empty = not configured.
  RESEND_API_KEY: optionalString(z.string().trim().min(1)),
  // Sender, `address` or `Name <address>`. PROVISIONAL: the final sending domain depends on
  // DEC-01b (SPF/DKIM to verify before production).
  EMAIL_FROM: optionalString(z.string().refine(isEmailSender)),
  EMAIL_REPLY_TO: optionalString(z.email()),
  // Minimum booking lead time in minutes (BR-31). PROVISIONAL: 12 h (720) by default, pending
  // the owners' confirmation; below it the quote is refused (BOOKING_LEAD_TIME_TOO_SHORT).
  // Must be > 0: zero would disable the lead time check (BR-31).
  // An empty value (as copied from .env.example) means "use the default".
  BOOKING_MIN_LEAD_TIME_MINUTES: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().default(720),
  ),
  // Broad service area of routed points, `south,west,north,east` in degrees (VTC-039): a
  // resolved pickup or drop-off outside it, or at (0, 0), gets no price. PROVISIONAL: defaults to
  // metropolitan France, pending the operating zone decision. Empty = default.
  ROUTING_SERVICE_AREA: z.preprocess(
    (value) => (value === "" ? undefined : value),
    ServiceAreaSchema.default({ ...PROVISIONAL_SERVICE_AREA }),
  ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly variables: readonly string[]) {
    // Names and issue codes only: a value may be a secret and must never reach a log.
    super(`Invalid or missing environment variables: ${variables.join(", ")}`);
    this.name = "EnvValidationError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) return result.data;

  const variables = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join(".") || "(root)";
    return `${name} (${issue.code})`;
  });
  throw new EnvValidationError(variables);
}
