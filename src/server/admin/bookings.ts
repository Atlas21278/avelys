import "server-only";

import { type AccessDenialReason, BACK_OFFICE_ROLES } from "@/domain/auth/access";
import { splitPriorityPage } from "@/domain/booking/back-office-order";
import { type BookingContact, resolveBookingContact } from "@/domain/booking/contact";
import { InvalidBookingReferenceError, normalizeReference } from "@/domain/booking/reference";
import { BOOKING_STATUSES, type BookingStatus } from "@/domain/booking/status";
import type { BookingActor } from "@/domain/booking/transitions";
import type { Prisma } from "@/generated/prisma/client";
import { parisDayEnd, parisDayStart } from "@/lib/dates";
import { checkAccess, type StaffIdentity } from "@/server/auth/access";
import { db } from "@/server/db";

import { BOOKING_LIST_PAGE_SIZE, type BookingListQuery } from "./booking-list-query";

/**
 * Back-office read access to bookings (VTC-029), read-only. Every function checks the caller's
 * role and 2FA itself (Master Spec §18), even though each page also runs its guard: a future
 * caller (server action, route handler) cannot skip the check. Results are minimal DTOs with an
 * explicit `select`: no pricing snapshot, no coordinates, no customer data beyond what the
 * screen shows. Nothing here logs personal data (BR-60).
 */

/** Raised when the request's session may not read back-office data. Carries no personal data. */
export class BackOfficeAccessError extends Error {
  override readonly name = "BackOfficeAccessError";
  readonly code = "BACK_OFFICE_ACCESS_DENIED";

  constructor(readonly reason: AccessDenialReason) {
    super(`Back-office access denied: ${reason}`);
  }
}

async function authorize(requestHeaders: Headers): Promise<StaffIdentity> {
  const access = await checkAccess(requestHeaders, BACK_OFFICE_ROLES);
  if (!access.ok) throw new BackOfficeAccessError(access.reason);
  return access.user;
}

const PRIORITY_STATUS = "REQUESTED" satisfies BookingStatus;

// Stable order inside each segment: pickup instant, then id for equal instants.
const SEGMENT_ORDER = [
  { pickupAt: "asc" },
  { id: "asc" },
] as const satisfies Prisma.BookingOrderByWithRelationInput[];

const LIST_SELECT = {
  reference: true,
  status: true,
  pickupAt: true,
  pickupLabel: true,
  dropoffLabel: true,
  passengerCount: true,
  luggageCount: true,
  totalTtcCents: true,
  currency: true,
  // Read only to resolve the displayed name like the detail does (VTC-038); not returned.
  contactName: true,
  contactPhone: true,
  contactLocale: true,
  customer: { select: { name: true, phone: true, preferredLocale: true } },
} as const satisfies Prisma.BookingSelect;

export interface BookingListItem {
  readonly reference: string;
  readonly status: BookingStatus;
  readonly pickupAt: Date;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
  readonly passengerCount: number;
  readonly luggageCount: number;
  readonly totalTtcCents: number;
  readonly currency: string;
  /** Name from the booking's own contact copy, or its customer for older rows (VTC-038). */
  readonly contactName: string;
}

export interface BookingListPage {
  readonly items: readonly BookingListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly pageCount: number;
}

type ListRow = Prisma.BookingGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem({
  customer,
  contactName,
  contactPhone,
  contactLocale,
  ...row
}: ListRow): BookingListItem {
  const contact = resolveBookingContact({ contactName, contactPhone, contactLocale }, customer);
  return { ...row, contactName: contact.name };
}

function pickupRange(query: BookingListQuery): Prisma.DateTimeFilter | undefined {
  if (!query.from && !query.to) return undefined;
  return {
    ...(query.from ? { gte: parisDayStart(query.from) } : {}),
    ...(query.to ? { lt: parisDayEnd(query.to) } : {}),
  };
}

/**
 * One page of bookings: `REQUESTED` first, then the other statuses, each by pickup instant
 * ascending (Master Spec §14). Filters: statuses (empty = all) and Paris calendar days of pickup.
 */
export async function listBackOfficeBookings(
  requestHeaders: Headers,
  query: BookingListQuery,
): Promise<BookingListPage> {
  await authorize(requestHeaders);

  const selected = query.statuses.length > 0 ? query.statuses : BOOKING_STATUSES;
  const range = pickupRange(query);
  const base: Prisma.BookingWhereInput = range ? { pickupAt: range } : {};
  const priorityWhere: Prisma.BookingWhereInput | null = selected.includes(PRIORITY_STATUS)
    ? { ...base, status: PRIORITY_STATUS }
    : null;
  const restStatuses = selected.filter((status) => status !== PRIORITY_STATUS);
  const restWhere: Prisma.BookingWhereInput | null =
    restStatuses.length > 0 ? { ...base, status: { in: restStatuses } } : null;

  const client = db();
  const [priorityCount, restCount] = await Promise.all([
    priorityWhere ? client.booking.count({ where: priorityWhere }) : 0,
    restWhere ? client.booking.count({ where: restWhere }) : 0,
  ]);

  const pageSize = BOOKING_LIST_PAGE_SIZE;
  const split = splitPriorityPage(priorityCount, (query.page - 1) * pageSize, pageSize);
  const [priorityRows, restRows] = await Promise.all([
    priorityWhere && split.priority
      ? client.booking.findMany({
          where: priorityWhere,
          orderBy: SEGMENT_ORDER,
          skip: split.priority.skip,
          take: split.priority.take,
          select: LIST_SELECT,
        })
      : [],
    restWhere && split.rest && split.rest.skip < restCount
      ? client.booking.findMany({
          where: restWhere,
          orderBy: SEGMENT_ORDER,
          skip: split.rest.skip,
          take: split.rest.take,
          select: LIST_SELECT,
        })
      : [],
  ]);

  const total = priorityCount + restCount;
  return {
    items: [...priorityRows, ...restRows].map(toListItem),
    page: query.page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

const DETAIL_SELECT = {
  id: true,
  reference: true,
  status: true,
  contactName: true,
  contactPhone: true,
  contactLocale: true,
  pickupLabel: true,
  dropoffLabel: true,
  pickupAt: true,
  passengerCount: true,
  luggageCount: true,
  quotedDistanceMeters: true,
  quotedDurationSeconds: true,
  totalTtcCents: true,
  totalHtCents: true,
  vatCents: true,
  currency: true,
  pricingRuleVersion: true,
  transportKind: true,
  transportNumber: true,
  transportOrigin: true,
  transportTerminal: true,
  transportScheduledAt: true,
  customerNotes: true,
  internalNotes: true,
  // Optimistic lock sent back by the accept/refuse actions (VTC-032).
  version: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  completedAt: true,
  customer: { select: { name: true, email: true, phone: true, preferredLocale: true } },
} as const satisfies Prisma.BookingSelect;

type DetailRow = Prisma.BookingGetPayload<{ select: typeof DETAIL_SELECT }>;

export interface BookingAuditEntry {
  readonly id: string;
  readonly createdAt: Date;
  readonly actorType: BookingActor;
  /** Name of the staff member for ADMIN, DISPATCHER and DRIVER actors, when the account exists. */
  readonly actorName: string | null;
  readonly action: string;
  /** Statuses read from `before.status` / `after.status`, when the entry is a transition. */
  readonly fromStatus: BookingStatus | null;
  readonly toStatus: BookingStatus | null;
}

export type BookingDetail = Omit<
  DetailRow,
  "id" | "customer" | "contactName" | "contactPhone" | "contactLocale"
> & {
  /** Contact of this booking (VTC-037), from its own copy or, for older rows, its customer. */
  readonly contact: BookingContact;
  /** Email of the customer profile: the guest matching key, not copied per booking (DEC-25). */
  readonly customerEmail: string;
  readonly audit: readonly BookingAuditEntry[];
};

const STAFF_ACTORS: readonly BookingActor[] = ["ADMIN", "DISPATCHER", "DRIVER"];

function statusIn(json: Prisma.JsonValue | null): BookingStatus | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const status = json.status;
  return typeof status === "string" && (BOOKING_STATUSES as readonly string[]).includes(status)
    ? (status as BookingStatus)
    : null;
}

async function auditTrail(bookingId: string): Promise<BookingAuditEntry[]> {
  const client = db();
  const rows = await client.auditLog.findMany({
    where: { entityType: "Booking", entityId: bookingId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
      actorType: true,
      actorId: true,
      action: true,
      before: true,
      after: true,
    },
  });

  const staffIds = [
    ...new Set(
      rows.flatMap((row) =>
        STAFF_ACTORS.includes(row.actorType) && row.actorId ? [row.actorId] : [],
      ),
    ),
  ];
  const staff =
    staffIds.length > 0
      ? await client.user.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      : [];
  const names = new Map(staff.map((user) => [user.id, user.name]));

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorType: row.actorType,
    actorName:
      STAFF_ACTORS.includes(row.actorType) && row.actorId ? (names.get(row.actorId) ?? null) : null,
    action: row.action,
    fromStatus: statusIn(row.before),
    toStatus: statusIn(row.after),
  }));
}

/**
 * One booking by its public reference, typed or pasted (tolerant `normalizeReference`), with
 * its audit trail in chronological order. Null when the reference is invalid or unknown.
 */
export async function getBackOfficeBooking(
  requestHeaders: Headers,
  rawReference: string,
): Promise<BookingDetail | null> {
  await authorize(requestHeaders);

  let reference: string;
  try {
    reference = normalizeReference(rawReference);
  } catch (error) {
    if (error instanceof InvalidBookingReferenceError) return null;
    throw error;
  }

  const row = await db().booking.findUnique({ where: { reference }, select: DETAIL_SELECT });
  if (!row) return null;

  const { id, customer, contactName, contactPhone, contactLocale, ...booking } = row;
  return {
    ...booking,
    contact: resolveBookingContact({ contactName, contactPhone, contactLocale }, customer),
    customerEmail: customer.email,
    audit: await auditTrail(id),
  };
}
