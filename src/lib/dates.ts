import { TZDate, tz } from "@date-fns/tz";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * Dates are stored in UTC and displayed in Europe/Paris (BR-52, ADR-0003). Every conversion goes
 * through the IANA zone database (@date-fns/tz), never through a fixed offset: Paris switches
 * between UTC+1 and UTC+2 on the last Sundays of March and October.
 */
export const PARIS_TIME_ZONE = "Europe/Paris";

const inParis = tz(PARIS_TIME_ZONE);

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
