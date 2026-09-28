import "server-only";

import { randomInt } from "node:crypto";

import { createReference } from "@/domain/booking/reference";

/**
 * Draws a new public booking reference (ADR-0015) from the cryptographic generator of
 * `node:crypto`, never `Math.random` (enforced by ESLint). Uniqueness is guaranteed by the
 * database; the bounded retry on collision belongs to the booking creation service.
 */
export function generateReference(): string {
  return createReference(randomInt);
}
