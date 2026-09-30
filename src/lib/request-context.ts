import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type RequestContext = { correlationId: string };

const storage = new AsyncLocalStorage<RequestContext>();

// Accept an upstream id (ingress, load balancer) only if it looks like one: it ends up in logs.
const INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Correlation id of a request: the upstream `x-request-id` when well formed, a fresh UUID
 * otherwise. `ignoreIncoming` (VTC-045) always draws a server id: on anonymous public routes whose
 * id reaches the AuditLog, the client must not choose it (it could forge or collide with another
 * request's trail).
 */
export function correlationIdFrom(
  headers: Headers,
  options: { ignoreIncoming?: boolean } = {},
): string {
  if (options.ignoreIncoming) return randomUUID();
  const incoming = headers.get("x-request-id");
  return incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
