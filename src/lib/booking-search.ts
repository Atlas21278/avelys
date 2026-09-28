import { z } from "zod";

import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * Trip search carried from the home page to the booking page as URL parameters.
 *
 * Every field is optional: the booking page (EPIC-09) asks for what is missing. The search
 * never carries an amount (CLAUDE.md rule 1): the price is computed by the server quote only.
 * No maximum passenger or luggage count is set here (DEC-02 open, BR-24), and the minimum
 * lead time (BR-31) is checked by the booking flow, not by the search.
 */
export const BOOKING_SEARCH_FIELDS = [
  "pickup",
  "dropoff",
  "date",
  "time",
  "passengers",
  "luggage",
] as const;

// Free-text place, not yet geocoded (autocomplete comes with the quote, EPIC-08). The length
// cap only keeps URLs reasonable.
const PLACE_MAX_LENGTH = 200;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A trimmed string; blank becomes undefined so it is left out of the URL. */
const optionalTrimmed = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const place = optionalTrimmed.pipe(z.string().max(PLACE_MAX_LENGTH).optional());

/** Calendar date as sent by `<input type="date">`, interpreted in Europe/Paris later. */
const date = optionalTrimmed.pipe(
  z
    .string()
    .refine((value) => {
      const match = DATE_PATTERN.exec(value);
      if (!match) return false;
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      );
    }, "Invalid date")
    .optional(),
);

/** Wall-clock time `HH:MM` in Europe/Paris, as sent by `<input type="time">`. */
const time = optionalTrimmed.pipe(z.string().regex(TIME_PATTERN).optional());

/** Whole number of at least `min`, from a form string or a number; no upper bound. */
function count(min: number) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const text = typeof value === "number" ? String(value) : value.trim();
      return text === "" ? undefined : text;
    })
    .pipe(
      z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(min).max(Number.MAX_SAFE_INTEGER))
        .optional(),
    );
}

// z.object strips unknown keys, so an amount slipped into the input never survives parsing.
export const bookingSearchSchema = z.object({
  pickup: place,
  dropoff: place,
  date,
  time,
  passengers: count(1),
  luggage: count(0),
});

export type BookingSearch = z.infer<typeof bookingSearchSchema>;

/** Validates and normalises raw search input (form data or URL parameters). */
export function parseBookingSearch(input: Record<string, unknown>) {
  const result = bookingSearchSchema.safeParse(input);
  if (!result.success) return result;
  // Drop the keys of empty fields so `data` only holds what the visitor filled in.
  const data = Object.fromEntries(
    Object.entries(result.data).filter(([, value]) => value !== undefined),
  ) as BookingSearch;
  return { ...result, data };
}

/** Raw URL parameters, as given by a page's `searchParams` or a `URLSearchParams`. */
export type RawSearchParams = URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * Tolerant reading of the search carried in a URL (booking page): each field is validated on
 * its own, an invalid or repeated-but-invalid field is simply left out, and nothing throws.
 * A repeated parameter keeps its first value. Unknown parameters (an amount, for instance)
 * are ignored.
 */
export function readBookingSearch(params: RawSearchParams): BookingSearch {
  const search: Record<string, string | number> = {};
  for (const field of BOOKING_SEARCH_FIELDS) {
    const raw = params instanceof URLSearchParams ? params.get(field) : params[field];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === null) continue;
    const result = bookingSearchSchema.shape[field].safeParse(value);
    if (result.success && result.data !== undefined) search[field] = result.data;
  }
  return search as BookingSearch;
}

/** URL query string (without `?`) with the filled fields, in a stable order. */
export function bookingSearchQuery(search: BookingSearch): string {
  const params = new URLSearchParams();
  for (const field of BOOKING_SEARCH_FIELDS) {
    const value = search[field];
    if (value !== undefined) params.set(field, String(value));
  }
  return params.toString();
}

/** Link to the booking page in `locale` (slug from the routing table), search pre-filled. */
export function bookingSearchHref(search: BookingSearch, locale: Locale): string {
  const pathname = getPathname({ href: "/reservation", locale });
  const query = bookingSearchQuery(search);
  return query ? `${pathname}?${query}` : pathname;
}
