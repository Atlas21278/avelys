import "server-only";

import { parseServerEnv, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/**
 * Validated server environment, parsed on first use rather than at import time so that
 * `next build` can import route modules without runtime variables. The first request of a
 * misconfigured deployment fails loudly, naming the variables (never their values).
 */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
