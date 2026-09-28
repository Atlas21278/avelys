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
