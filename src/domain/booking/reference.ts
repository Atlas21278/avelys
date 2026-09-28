/**
 * Public booking reference (ADR-0015, Master Spec §20.1): a prefix plus 8 Crockford base32
 * characters drawn by a cryptographic generator. Never sequential, never guessable. The
 * reference alone grants no access to a booking (signed link, docs/architecture/security.md).
 *
 * This module is pure: the random source is injected. The server wires it to `node:crypto`
 * (src/server/booking/reference.ts). Uniqueness is enforced by the database and the bounded
 * retry on collision belongs to the booking creation service.
 */

import { DomainError } from "../errors";

/**
 * PROVISIONAL — DEC-22: `VTC-` or `AVL-` is still open. This is the only place the prefix is
 * written; change it here before the first real booking if DEC-22 decides otherwise.
 */
export const BOOKING_REFERENCE_PREFIX = "VTC-";

/** Crockford base32: digits and uppercase letters without I, L, O and U. */
export const BOOKING_REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Number of random characters after the prefix. */
export const BOOKING_REFERENCE_LENGTH = 8;

/**
 * Random source: returns a uniformly distributed integer in `[0, maxExclusive)`. Must be
 * cryptographically secure in production (`crypto.randomInt`), never `Math.random`.
 */
export type RandomIntSource = (maxExclusive: number) => number;

/** Longest raw input considered before normalisation (spaces and dashes included). */
const MAX_INPUT_LENGTH = 64;

/** Characters a human may type: ASCII letters and digits, whitespace, dashes. */
const TYPABLE_INPUT = /^[0-9A-Za-z\s-‐-―−]*$/;
const SEPARATORS = /[\s-‐-―−]/g;

/** Human confusions accepted at input (ADR-0015). `U` is deliberately not mapped. */
const EQUIVALENCES: Readonly<Record<string, string>> = Object.freeze({ O: "0", I: "1", L: "1" });

/** Prefix as it appears once case is folded and separators removed (letters only). */
const FOLDED_PREFIX = BOOKING_REFERENCE_PREFIX.toUpperCase().replace(SEPARATORS, "");

const CANONICAL_BODY = new RegExp(`^[${BOOKING_REFERENCE_ALPHABET}]{${BOOKING_REFERENCE_LENGTH}}$`);

/**
 * Raised when a value is not, and cannot be read as, a booking reference. The message never
 * echoes the input: it may be arbitrary user text.
 */
export class InvalidBookingReferenceError extends DomainError {
  override readonly name = "InvalidBookingReferenceError";
  readonly code = "INVALID_BOOKING_REFERENCE";

  constructor() {
    super("Invalid booking reference");
  }
}

/** Draws the 8 reference characters from the injected random source. */
export function drawReferenceChars(randomInt: RandomIntSource): string {
  const size = BOOKING_REFERENCE_ALPHABET.length;
  let chars = "";
  for (let i = 0; i < BOOKING_REFERENCE_LENGTH; i += 1) {
    const index = randomInt(size);
    const char = Number.isInteger(index) ? BOOKING_REFERENCE_ALPHABET[index] : undefined;
    if (char === undefined) {
      // Programming error in the random source, not a user error.
      throw new RangeError(`Random source returned ${String(index)}, expected [0, ${size})`);
    }
    chars += char;
  }
  return chars;
}

/** Builds the canonical reference from exactly 8 canonical alphabet characters. */
export function formatReference(chars: string): string {
  if (!CANONICAL_BODY.test(chars)) throw new InvalidBookingReferenceError();
  return `${BOOKING_REFERENCE_PREFIX}${chars}`;
}

/** Draws a new canonical reference. Uniqueness is checked by the caller against the database. */
export function createReference(randomInt: RandomIntSource): string {
  return formatReference(drawReferenceChars(randomInt));
}

/**
 * Reads a reference typed or dictated by a human and returns its canonical form. Case is
 * ignored, whitespace and dashes are removed, `O` reads `0`, `I` and `L` read `1`, and the
 * prefix may be omitted. Any other character (including `U` and accented letters) is rejected
 * with {@link InvalidBookingReferenceError}.
 */
export function normalizeReference(input: string): string {
  if (input.length > MAX_INPUT_LENGTH || !TYPABLE_INPUT.test(input)) {
    throw new InvalidBookingReferenceError();
  }
  let body = input.replace(SEPARATORS, "").toUpperCase();
  // Length disambiguates: a bare 8-character body may itself start with the prefix letters.
  if (
    body.length === FOLDED_PREFIX.length + BOOKING_REFERENCE_LENGTH &&
    body.startsWith(FOLDED_PREFIX)
  ) {
    body = body.slice(FOLDED_PREFIX.length);
  }
  body = body.replace(/[OIL]/g, (char) => EQUIVALENCES[char] ?? char);
  return formatReference(body);
}

/** Whether `value` is a reference in canonical form (as stored), without tolerance. */
export function isValidReference(value: string): boolean {
  return (
    value.startsWith(BOOKING_REFERENCE_PREFIX) &&
    CANONICAL_BODY.test(value.slice(BOOKING_REFERENCE_PREFIX.length))
  );
}
