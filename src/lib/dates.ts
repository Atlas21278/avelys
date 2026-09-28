/**
 * Wall-clock date/time handling (BR-52): instants are stored in UTC, the customer enters and
 * reads times in Europe/Paris. Conversion goes through `@date-fns/tz` (ADR-0003), never through
 * the server's own time zone.
 */

import { tzOffset } from "@date-fns/tz";

export const PARIS_TIME_ZONE = "Europe/Paris";

/** `YYYY-MM-DDTHH:mm`, no seconds and no offset: a wall-clock time as typed by a person. */
export const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Wall-clock components as a UTC timestamp (the "naive" instant): `Date.UTC(y, m, d, h, mi)`.
 * Returns `null` when the string is malformed or names an impossible date (2026-02-30, 24:00).
 */
export function parseLocalDateTime(value: string): number | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > 23 || minute > 59) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(naive);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return naive;
}

export type LocalTimeResolution =
  | { readonly kind: "exact"; readonly instant: Date }
  /** Skipped by a forward clock change (spring, 02:00–02:59 in Paris). */
  | { readonly kind: "nonexistent" }
  /** Repeated by a backward clock change (autumn, 02:00–02:59 in Paris): two instants. */
  | { readonly kind: "ambiguous"; readonly instants: readonly [Date, Date] }
  | { readonly kind: "invalid" };

/**
 * Converts a wall-clock `YYYY-MM-DDTHH:mm` in `timeZone` to UTC. A local time that does not
 * exist or occurs twice (daylight saving changes) is reported as such, never silently shifted.
 *
 * Candidate offsets are the zone's offsets one day before and one day after; each candidate
 * instant is kept only if the zone really has that offset at that instant.
 */
export function resolveLocalDateTime(value: string, timeZone: string): LocalTimeResolution {
  const naive = parseLocalDateTime(value);
  if (naive === null) return { kind: "invalid" };

  const offsets = new Set([
    tzOffset(timeZone, new Date(naive - MS_PER_DAY)),
    tzOffset(timeZone, new Date(naive + MS_PER_DAY)),
  ]);
  const instants = [...offsets]
    .map((offset) => naive - offset * MS_PER_MINUTE)
    .filter((instant) => naive - tzOffset(timeZone, new Date(instant)) * MS_PER_MINUTE === instant)
    .sort((a, b) => a - b)
    .map((instant) => new Date(instant));

  const [first, second] = instants;
  if (first === undefined) return { kind: "nonexistent" };
  if (second === undefined) return { kind: "exact", instant: first };
  return { kind: "ambiguous", instants: [first, second] };
}
