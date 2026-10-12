import * as z from "zod";

import { MIN_REGULARIZATION_KEY_LENGTH } from "@/domain/payment/regularization-token";
import { PROVISIONAL_SERVICE_AREA, ServiceAreaSchema } from "@/domain/geo/service-area";
import { isEmailSender } from "@/integrations/email/address";
import {
  isTestModePublishableKey,
  isTestModeSecretKey,
  isWebhookSigningSecret,
} from "@/integrations/stripe/keys";

/** APP_ENV values where the end-to-end test switches may be set (VTC-048). */
export const E2E_ALLOWED_APP_ENVS: ReadonlySet<string> = new Set(["local", "ci"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** A URL on the local machine only: a test fake never runs on another host. */
function isLoopbackUrl(value: string): boolean {
  return LOOPBACK_HOSTS.has(new URL(value).hostname);
}

/** An empty value (as copied from .env.example) means "not configured". */
const optionalString = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * Server-side environment. Stripe, Maps and Resend variables come from their own tickets.
 * Public (NEXT_PUBLIC_*) variables will get a separate schema when the first one is needed:
 * Next.js only inlines them when referenced literally, so they cannot share this parser.
 */
export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    APP_ENV: z.enum(["local", "ci", "staging", "production"]),
    APP_URL: z.url({ protocol: /^https?$/ }),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Signs and encrypts Better Auth cookies, tokens and TOTP secrets (VTC-016). At least 32 characters.
    BETTER_AUTH_SECRET: z.string().min(32),
    // Signs the SCA regularisation links sent to customers (VTC-042, HMAC-SHA256). At least 32
    // characters, distinct from every other secret. Optional so that `next build` and every other
    // page work without it: absent, no link is generated and every link page answers "invalid".
    // Changing it invalidates every link in circulation (rotation: docs/architecture/security.md).
    // Empty = not configured.
    PAYMENT_LINK_SECRET: optionalString(z.string().min(MIN_REGULARIZATION_KEY_LENGTH)),
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
    // Google Maps Platform **browser** key (VTC-046, ADR-0010): Places API (New) autocomplete
    // only, restricted to the site's HTTP referrers and to Places API (New), with quotas and
    // budget alerts (DEC-17). Public by nature (it reaches the browser) but never used by the
    // server to call Google: the booking page reads it at request time and hands it to the
    // browser, so one image serves every environment (ADR-0013; a literal
    // `process.env.NEXT_PUBLIC_*` would be frozen at build time). Optional: without it the
    // booking page offers no online quote. Empty = not configured.
    NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: optionalString(z.string().trim().min(1)),
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
    // Exposure switch of the public booking routes (VTC-045): `POST /api/v1/bookings` and
    // `POST /api/v1/payment-setups` answer 404, with no Stripe call and no write, unless it is
    // "true". OFF by default in every environment; enabled locally and in CI, and in production
    // only by INFRA-006 once per-IP rate limiting (INFRA-005) is in place. Empty = default.
    PUBLIC_BOOKING_ENABLED: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    ),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    // End-to-end test switches (VTC-048, docs/process/e2e.md). TEST ONLY: refused below unless
    // APP_ENV is `local` or `ci`, so a staging or production deployment that sets them fails its
    // first request instead of running on a fake. Off / empty by default everywhere.
    // - E2E_FAKE_ROUTING: the server routing provider is a deterministic in-process table of
    //   test places (src/integrations/maps/fake-routing.ts): Google is never called.
    E2E_FAKE_ROUTING: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    ),
    // - E2E_STRIPE_API_URL: base URL of the local fake Stripe API the server client talks to
    //   instead of api.stripe.com (e2e/stubs/fake-stripe-server.ts). Loopback HTTP(S) only.
    E2E_STRIPE_API_URL: optionalString(z.url({ protocol: /^https?$/ }).refine(isLoopbackUrl)),
  })
  // Test switches exist only where tests run (VTC-048): reported by variable name only.
  .superRefine((env, context) => {
    if (E2E_ALLOWED_APP_ENVS.has(env.APP_ENV)) return;
    if (env.E2E_FAKE_ROUTING) {
      context.addIssue({
        code: "custom",
        path: ["E2E_FAKE_ROUTING"],
        message: "test-only switch, refused outside APP_ENV local or ci",
      });
    }
    if (env.E2E_STRIPE_API_URL !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["E2E_STRIPE_API_URL"],
        message: "test-only switch, refused outside APP_ENV local or ci",
      });
    }
  })
  // The payment link key must not reuse the auth secret (VTC-042): a leak or a rotation of one
  // must never affect the other. Reported by variable name only, never with a value.
  .superRefine((env, context) => {
    if (
      env.PAYMENT_LINK_SECRET !== undefined &&
      env.PAYMENT_LINK_SECRET === env.BETTER_AUTH_SECRET
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_LINK_SECRET"],
        message: "must differ from BETTER_AUTH_SECRET",
      });
    }
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
