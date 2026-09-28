/**
 * The Prisma seed writes provisional development data (PROVISIONAL — DEC-03 tariffs). It must
 * never run against staging or production: only these APP_ENV values are accepted.
 */
export const SEED_ALLOWED_APP_ENVS = ["local", "ci"] as const;

export class SeedNotAllowedError extends Error {
  override readonly name = "SeedNotAllowedError";

  constructor(appEnv: string | undefined) {
    super(
      `Seed refused: APP_ENV is ${appEnv === undefined ? "unset" : `"${appEnv}"`}; ` +
        `allowed only in ${SEED_ALLOWED_APP_ENVS.join(", ")}`,
    );
  }
}

/** Throws unless `appEnv` is exactly one of SEED_ALLOWED_APP_ENVS (no trimming, no case folding). */
export function assertSeedAllowed(appEnv: string | undefined): void {
  if (!(SEED_ALLOWED_APP_ENVS as readonly string[]).includes(appEnv ?? "")) {
    throw new SeedNotAllowedError(appEnv);
  }
}
