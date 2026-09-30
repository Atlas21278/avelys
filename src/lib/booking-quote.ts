import { z } from "zod";

import { parseLocalDateTime } from "@/lib/dates";
import { CURRENCIES, money, type DisplayLocale, type Money } from "@/lib/money";

/**
 * Browser side of the public quote step (VTC-046): turns what the visitor entered into a
 * `POST /api/v1/quotes` request and the server response into what the page shows. Pure and
 * framework-free so it can be tested without a browser.
 *
 * No amount is ever computed or sent here (BR-12, CLAUDE.md rule 1): the price shown is the
 * server's `totalTtcCents`, only formatted.
 */

/** Same cap as the server label (`src/server/quotes/quote.ts`): display text, not a pricing input. */
export const PLACE_LABEL_MAX_LENGTH = 200;

/** A place picked from the autocomplete list. Free text is never a valid place. */
export type ChosenPlace = Readonly<{ placeId: string; label: string }>;

/** The raw inputs of the quote form, as strings from the controls. */
export type QuoteDraft = Readonly<{
  pickup: ChosenPlace | null;
  dropoff: ChosenPlace | null;
  /** `YYYY-MM-DD` from `<input type="date">`. */
  date: string;
  /** `HH:MM` from `<input type="time">`, wall-clock time in Europe/Paris. */
  time: string;
  passengers: string;
  luggage: string;
}>;

export type QuoteRequestBody = Readonly<{
  origin: ChosenPlace;
  destination: ChosenPlace;
  pickupLocalDateTime: string;
  passengers: number;
  luggage: number;
}>;

export const QUOTE_DRAFT_FIELDS = [
  "pickup",
  "dropoff",
  "date",
  "time",
  "passengers",
  "luggage",
] as const;
export type QuoteDraftField = (typeof QUOTE_DRAFT_FIELDS)[number];

export type QuoteRequestResult =
  | { readonly ok: true; readonly request: QuoteRequestBody }
  | { readonly ok: false; readonly issues: readonly QuoteDraftField[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WHOLE_NUMBER = /^\d+$/;

function chosen(place: ChosenPlace | null): ChosenPlace | null {
  if (!place) return null;
  const placeId = place.placeId.trim();
  const label = place.label.trim().slice(0, PLACE_LABEL_MAX_LENGTH).trim();
  return placeId && label ? { placeId, label } : null;
}

function count(value: string, min: number): number | null {
  const text = value.trim();
  if (!WHOLE_NUMBER.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : null;
}

/**
 * Builds the quote request, or lists the fields to fix. The pickup time is sent as the
 * wall-clock `YYYY-MM-DDTHH:mm` the visitor typed (Europe/Paris): the server converts it to UTC
 * and reports nonexistent or ambiguous times itself (daylight saving changes).
 */
export function buildQuoteRequest(draft: QuoteDraft): QuoteRequestResult {
  const issues: QuoteDraftField[] = [];
  const origin = chosen(draft.pickup);
  const destination = chosen(draft.dropoff);
  if (!origin) issues.push("pickup");
  if (!destination) issues.push("dropoff");

  const date = draft.date.trim();
  const time = draft.time.trim();
  const dateValid = DATE_PATTERN.test(date) && parseLocalDateTime(`${date}T00:00`) !== null;
  const timeValid = TIME_PATTERN.test(time);
  if (!dateValid) issues.push("date");
  if (!timeValid) issues.push("time");

  const passengers = count(draft.passengers, 1);
  const luggage = count(draft.luggage, 0);
  if (passengers === null) issues.push("passengers");
  if (luggage === null) issues.push("luggage");

  if (issues.length > 0 || !origin || !destination || passengers === null || luggage === null) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    request: {
      origin,
      destination,
      pickupLocalDateTime: `${date}T${time}`,
      passengers,
      luggage,
    },
  };
}

const cents = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The fields of the server quote the page relies on (docs/architecture/api.md). */
const QuoteResponseSchema = z.object({
  quote: z.object({
    snapshotId: z.string().min(1),
    currency: z.enum(CURRENCIES),
    totalTtcCents: cents,
    totalHtCents: cents.nullable(),
    vatCents: cents.nullable(),
    distanceMeters: z.number().min(0),
    durationSeconds: z.number().min(0),
    pickupAt: z.iso.datetime({ offset: true }),
    pickupLocalDateTime: z.string(),
    timeZone: z.string(),
    pricingRuleVersion: z.int(),
  }),
});

/** A server quote ready for display. Amounts stay in integer cents. */
export type DisplayQuote = Readonly<{
  snapshotId: string;
  total: Money;
  /** Shown only when the server provides it (DEC-04: null while VAT is undecided). */
  totalHt: Money | null;
  vat: Money | null;
  distanceMeters: number;
  durationSeconds: number;
  /** UTC instant of the pickup, ISO 8601; displayed in Europe/Paris. */
  pickupAt: string;
  pickupLocalDateTime: string;
  timeZone: string;
  pricingRuleVersion: number;
}>;

/** Reads a 200 response body; `null` when it is not a well-formed quote (never a guessed price). */
export function readQuoteResponse(body: unknown): DisplayQuote | null {
  const parsed = QuoteResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  const { quote } = parsed.data;
  return {
    snapshotId: quote.snapshotId,
    total: money(quote.totalTtcCents, quote.currency),
    totalHt: quote.totalHtCents === null ? null : money(quote.totalHtCents, quote.currency),
    vat: quote.vatCents === null ? null : money(quote.vatCents, quote.currency),
    distanceMeters: quote.distanceMeters,
    durationSeconds: quote.durationSeconds,
    pickupAt: quote.pickupAt,
    pickupLocalDateTime: quote.pickupLocalDateTime,
    timeZone: quote.timeZone,
    pricingRuleVersion: quote.pricingRuleVersion,
  };
}

/**
 * What the visitor is told when no quote is shown. Every error code of the quote endpoint maps
 * to one of these; unknown codes and malformed bodies read as `unavailable`. None of them
 * carries a technical detail.
 */
export const QUOTE_FAILURES = [
  "leadTime",
  "timeNonexistent",
  "timeAmbiguous",
  "noRoute",
  "invalidRequest",
  "unavailable",
  "network",
] as const;
export type QuoteFailure = (typeof QUOTE_FAILURES)[number];

/** Error codes `POST /api/v1/quotes` can answer (`QuoteErrorCode` + the unexpected case). */
export const QUOTE_ERROR_CODES = [
  "INVALID_INPUT",
  "BOOKING_LEAD_TIME_TOO_SHORT",
  "LOCAL_TIME_NONEXISTENT",
  "LOCAL_TIME_AMBIGUOUS",
  "ROUTE_UNAVAILABLE",
  "NO_ACTIVE_PRICING_RULE",
  "PRICING_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/**
 * Maps a non-200 response to a failure. `ROUTE_UNAVAILABLE` is 422 when no road route exists
 * between the places and 503 when the provider is down: only the first blames the trip.
 */
export function quoteFailureOf(status: number, body: unknown): QuoteFailure {
  const parsed = ErrorBodySchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  switch (code) {
    case "BOOKING_LEAD_TIME_TOO_SHORT":
      return "leadTime";
    case "LOCAL_TIME_NONEXISTENT":
      return "timeNonexistent";
    case "LOCAL_TIME_AMBIGUOUS":
      return "timeAmbiguous";
    case "ROUTE_UNAVAILABLE":
      return status === 422 ? "noRoute" : "unavailable";
    case "INVALID_INPUT":
      return "invalidRequest";
    default:
      return "unavailable";
  }
}

const INTL_LOCALES: Record<DisplayLocale, string> = { fr: "fr-FR", en: "en-GB" };

/** Road distance for display, in kilometres with one decimal at most. */
export function formatDistance(meters: number, locale: DisplayLocale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(meters / 1000);
}

/** Estimated driving time for display, rounded to the minute (at least one minute). */
export function formatDuration(seconds: number, locale: DisplayLocale): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: "hour" | "minute") =>
    new Intl.NumberFormat(INTL_LOCALES[locale], {
      style: "unit",
      unit: name,
      unitDisplay: "short",
    }).format(value);
  if (hours === 0) return unit(minutes, "minute");
  return minutes === 0 ? unit(hours, "hour") : `${unit(hours, "hour")} ${unit(minutes, "minute")}`;
}

/**
 * Identity of a retained quote for the next step (VTC-047): the places (id and label), the
 * wall-clock time, the passengers and luggage, and the total shown. When it changes after the
 * card was saved, step 2 must discard its SetupIntent and `submissionId` and draw new ones
 * (review note of VTC-045): a replayed submission would otherwise return the reference of the
 * previous trip. The snapshot id is left out on purpose: re-quoting the same trip at the same
 * price is not a change.
 */
export function quoteFingerprint(request: QuoteRequestBody, quote: DisplayQuote): string {
  return JSON.stringify([
    request.origin.placeId,
    request.origin.label,
    request.destination.placeId,
    request.destination.label,
    request.pickupLocalDateTime,
    request.passengers,
    request.luggage,
    quote.total.amountCents,
    quote.total.currency,
  ]);
}
