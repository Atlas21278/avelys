import "server-only";

import { db } from "./db";

const DATABASE_TIMEOUT_MS = 2_000;

export type DatabaseCheck =
  { ok: true } | { ok: false; reason: "timeout" | "error"; error?: unknown };

/** Readiness check: one round trip to PostgreSQL, bounded so a hung pool cannot stall probes. */
export async function checkDatabase(timeoutMs = DATABASE_TIMEOUT_MS): Promise<DatabaseCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DatabaseCheck>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });
  const query = db().$queryRaw`SELECT 1`
    .then((): DatabaseCheck => ({ ok: true }))
    .catch((error: unknown): DatabaseCheck => ({ ok: false, reason: "error", error }));
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
