import { TZDate, tz, tzOffset } from "@date-fns/tz";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * Dates are stored in UTC and displayed in Europe/Paris (BR-52, ADR-0003). Every conversion goes
 * through the IANA zone database (@date-fns/tz), never through a fixed offset nor the server's own
 * time zone: Paris switches between UTC+1 and UTC+2 on the last Sundays of March and October.
 *
 * Two directions live here:
 * - wall-clock → UTC (`parseLocalDateTime`, `resolveLocalDateTime`): customer input;
 * - UTC → Paris display and Paris calendar days as UTC ranges: back-office screens.
 */
export const PARIS_TIME_ZONE = "Europe/Paris";

const inParis = tz(PARIS_TIME_ZONE);

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DDTHH:mm`, no seconds and no offset: a wall-clock time as typed by a person. */
export const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Wall-clock → UTC
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// UTC → Paris display
// ---------------------------------------------------------------------------------------------

/** `dim. 25 oct. 2026` */
export function formatParisDate(instant: Date): string {
  return format(instant, "EEE d MMM yyyy", { in: inParis, locale: fr });
}

/** `02:30` (24-hour clock). */
export function formatParisTime(instant: Date): string {
  return format(instant, "HH:mm", { in: inParis, locale: fr });
}

/** `dim. 25 oct. 2026, 02:30` */
export function formatParisDateTime(instant: Date): string {
  return `${formatParisDate(instant)}, ${formatParisTime(instant)}`;
}

/**
 * `UTC+01:00` or `UTC+02:00`: tells apart the two occurrences of the repeated hour at the end of
 * October (02:00–02:59 happens twice).
 */
export function formatParisOffset(instant: Date): string {
  return `UTC${format(instant, "xxx", { in: inParis })}`;
}

/**
 * Whether the Paris wall-clock reading of `instant` occurs twice (the repeated hour on the last
 * Sunday of October), so that date and time alone do not identify the instant.
 */
export function isAmbiguousParisTime(instant: Date): boolean {
  const wallClock = format(instant, "yyyy-MM-dd'T'HH:mm", { in: inParis });
  return resolveLocalDateTime(wallClock, PARIS_TIME_ZONE).kind === "ambiguous";
}

/**
 * `formatParisDateTime`, followed by the UTC offset only when the wall-clock time is ambiguous:
 * `dim. 25 oct. 2026, 02:30 (UTC+02:00)`.
 */
export function formatParisDateTimeUnambiguous(instant: Date): string {
  const text = formatParisDateTime(instant);
  return isAmbiguousParisTime(instant) ? `${text} (${formatParisOffset(instant)})` : text;
}

/** Calendar date of the instant in Paris, `YYYY-MM-DD`. */
export function toParisCalendarDate(instant: Date): string {
  return format(instant, "yyyy-MM-dd", { in: inParis });
}

function parseCalendarDate(value: string): { year: number; month: number; day: number } {
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new RangeError("Expected a calendar date YYYY-MM-DD");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError("Expected an existing calendar date");
  }
  return { year, month, day };
}

/** Whether `value` is an existing calendar date written `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * First instant (UTC) of the Paris calendar day `YYYY-MM-DD`. Midnight always exists in Paris:
 * the DST changes happen at 02:00 and 03:00.
 */
export function parisDayStart(calendarDate: string): Date {
  const { year, month, day } = parseCalendarDate(calendarDate);
  return new Date(new TZDate(year, month - 1, day, PARIS_TIME_ZONE).getTime());
}

/**
 * First instant (UTC) of the Paris day after `YYYY-MM-DD`: the exclusive upper bound of that
 * day. A day lasts 23 hours in late March and 25 hours in late October.
 */
export function parisDayEnd(calendarDate: string): Date {
  const { year, month, day } = parseCalendarDate(calendarDate);
  return new Date(new TZDate(year, month - 1, day + 1, PARIS_TIME_ZONE).getTime());
}
