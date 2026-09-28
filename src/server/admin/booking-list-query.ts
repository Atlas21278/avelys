import { z } from "zod";

import { BOOKING_STATUSES, type BookingStatus } from "@/domain/booking/status";
import { isCalendarDate } from "@/lib/dates";

/**
 * URL query of the back-office booking list (`/admin/reservations`). Untrusted input: every field
 * is validated, and an invalid value is dropped (back to its default) instead of failing the page.
 */

/** Rows per page (Master Spec §21: server-side pagination with a bounded size). */
export const BOOKING_LIST_PAGE_SIZE = 20;

/** Upper bound on the page number, so the database offset stays bounded. */
export const BOOKING_LIST_MAX_PAGE = 500;

export interface BookingListQuery {
  /** Statuses to show; empty means all. Deduplicated, in BOOKING_STATUSES order. */
  readonly statuses: readonly BookingStatus[];
  /** First Paris calendar day of pickup, `YYYY-MM-DD`, inclusive. */
  readonly from?: string;
  /** Last Paris calendar day of pickup, `YYYY-MM-DD`, inclusive. */
  readonly to?: string;
  /** 1-based page number. */
  readonly page: number;
}

const firstValue = (value: unknown) => (Array.isArray(value) ? (value[0] as unknown) : value);

const calendarDate = z.preprocess(
  firstValue,
  z.string().trim().refine(isCalendarDate).optional().catch(undefined),
);

const statuses = z.preprocess(
  (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
  z
    .array(z.unknown())
    .max(BOOKING_STATUSES.length * 2)
    .catch([])
    .transform((values) => BOOKING_STATUSES.filter((status) => values.includes(status))),
);

const page = z.preprocess(
  firstValue,
  z.coerce.number().int().min(1).max(BOOKING_LIST_MAX_PAGE).catch(1),
);

export const bookingListQuerySchema = z.object({
  status: statuses,
  from: calendarDate,
  to: calendarDate,
  page,
});

/** Parses the page `searchParams`. Never throws: invalid values fall back to their default. */
export function parseBookingListQuery(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): BookingListQuery {
  const parsed = bookingListQuerySchema.parse(searchParams);
  return {
    statuses: parsed.status,
    page: parsed.page,
    ...(parsed.from ? { from: parsed.from } : {}),
    ...(parsed.to ? { to: parsed.to } : {}),
  };
}

/** Builds the query string of a list URL (used by filter and pagination links). */
export function bookingListSearch(query: BookingListQuery): string {
  const params = new URLSearchParams();
  for (const status of query.statuses) params.append("status", status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `?${search}` : "";
}
