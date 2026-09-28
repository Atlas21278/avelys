import * as z from "zod";

/**
 * Server-side environment. Stripe, Maps and Resend variables are added by their own tickets.
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
  // Google Maps Platform server key (VTC-024, ADR-0010): Routes API only, restricted by API and
  // IP. Optional at startup so that `next build` and pages without routing work without it;
  // the routing adapter fails with a typed error on first use when it is missing.
  // An empty value (as copied from .env.example) means "not configured".
  GOOGLE_MAPS_SERVER_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  // Minimum booking lead time in minutes (BR-31). PROVISIONAL: 12 h (720) by default, pending
  // the owners' confirmation; below it the quote is refused (BOOKING_LEAD_TIME_TOO_SHORT).
  // An empty value (as copied from .env.example) means "use the default".
  BOOKING_MIN_LEAD_TIME_MINUTES: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().nonnegative().default(720),
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
