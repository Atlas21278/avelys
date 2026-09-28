import "server-only";

import { Prisma } from "@/generated/prisma/client";

/**
 * Prisma error codes meaning "PostgreSQL cannot be used right now", as opposed to a query that
 * PostgreSQL refused. With the pg driver adapter, connection failures surface as
 * `PrismaClientKnownRequestError` with one of these codes (observed: P1001 for an unreachable
 * host or port, P1000 for rejected credentials).
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "P1000", // authentication failed
  "P1001", // cannot reach the database server
  "P1002", // server reached but timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024", // timed out fetching a connection from the pool
]);

/**
 * When `error` means the database is unavailable (a transient, operational fault that deserves
 * a 503), a short tag for logs: the Prisma code, or `client_init`. Null for any other error,
 * which callers keep treating as a bug. The Prisma message is never used: it may quote a query.
 */
export function databaseUnavailableReason(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientInitializationError) return "client_init";
  if (error instanceof Prisma.PrismaClientKnownRequestError && UNAVAILABLE_CODES.has(error.code)) {
    return error.code;
  }
  return null;
}
