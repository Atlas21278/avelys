import "server-only";

import { z } from "zod";

import { ContactEmailSchema } from "@/domain/booking/contact";
import { INITIAL_BOOKING_STATUS, type BookingStatus } from "@/domain/booking/status";
import { assertCanCreateBooking } from "@/domain/booking/transitions";
import { INITIAL_PAYMENT_STATUS } from "@/domain/payment/status";
import { parsePricingSnapshot } from "@/domain/pricing/snapshot";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { ApiErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { CURRENCIES, type Money } from "@/lib/money";
import { currentCorrelationId } from "@/lib/request-context";
import { writeAuditLog } from "@/server/audit/audit-log";
import {
  QuoteError,
  type Quote,
  type QuoteErrorCode,
  type QuoteRequest,
} from "@/server/quotes/quote";

import type { ConfirmedPaymentMethod, PaymentMethodGuard } from "./payment-method-guard";

/**
 * Creation of a `REQUESTED` booking (VTC-028, Master Spec §6.2, §54.4, ADR-0008, ADR-0009).
 * The price is always recomputed by the server (BR-12): the amount displayed to the customer is
 * only compared with it, and the stored snapshot is the server's own (BR-13). Customer, Booking,
 * its `PENDING` Payment (VTC-031) and the AuditLog rows are written in one transaction. Nothing
 * is charged: no PaymentIntent exists at this stage. No public route or server action here.
 */

/** Display label of a place: stored on the booking, never priced, never logged. */
const LabelSchema = z.string().trim().min(1).max(200);

/**
 * A place of the booking form: coordinates plus, when the place came from Places autocomplete,
 * its id. The route is computed from the place id when present, from the coordinates otherwise —
 * as for the quote the customer saw. The submitted coordinates are a routing input only: the
 * booking stores the end points of the priced route (VTC-035), so a request cannot be priced
 * A→B and dispatched C→D.
 */
export const BookingPlaceSchema = z.strictObject({
  label: LabelSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  placeId: z.string().trim().min(1).max(1024).optional(),
});

const OptionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/**
 * Booking request. Strict: any unknown key is refused — a price, a snapshot or a `snapshotId`
 * from the client in particular (BR-12). `displayedTotal` is what the customer saw; it is only
 * compared with the recomputed price, never stored or used as a price.
 */
export const CreateBookingRequestSchema = z.strictObject({
  origin: BookingPlaceSchema,
  destination: BookingPlaceSchema,
  /** Wall-clock pickup time in Europe/Paris, `YYYY-MM-DDTHH:mm` (validated by the quote). */
  pickupLocalDateTime: z.string().max(32),
  passengers: z.int().min(1),
  luggage: z.int().min(0),
  customer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    email: ContactEmailSchema,
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 .()-]{5,31}$/)
      .optional(),
    locale: z.enum(["fr", "en"]).default("fr"),
  }),
  customerNotes: OptionalText(1_000),
  /** Airport or station arrival (BR-34): scheduled time distinct from the pickup time. */
  transport: z
    .strictObject({
      kind: z.enum(["FLIGHT", "TRAIN"]),
      number: OptionalText(32),
      origin: OptionalText(120),
      terminal: OptionalText(120),
      scheduledAt: z.iso.datetime({ offset: true }).optional(),
    })
    .optional(),
  termsAccepted: z.literal(true),
  displayedTotal: z.strictObject({
    amountCents: z.int().nonnegative(),
    currency: z.enum(CURRENCIES),
  }),
  /** SetupIntent id (`seti_…`) of the saved payment method, checked by the guard (VTC-031). */
  paymentSetupId: z.string().trim().min(1).max(255).optional(),
});

export type CreateBookingRequest = z.input<typeof CreateBookingRequestSchema>;
type ParsedRequest = z.output<typeof CreateBookingRequestSchema>;

export interface CreateBookingDeps {
  /** Server quote (`computeQuote` with its routing, rule store, clock and lead time). */
  readonly quote: (request: QuoteRequest) => Promise<Quote>;
  readonly paymentMethodGuard: PaymentMethodGuard;
  readonly generateReference: () => string;
  readonly db: PrismaClient;
  /**
   * Post-commit extension point (e.g. the acknowledgement email, EPIC-13). Its failure is logged
   * and never undoes nor fails the booking (BR-50).
   */
  readonly afterCommit?: (booking: CreatedBooking) => Promise<void>;
}

export type BookingCreationErrorCode =
  | QuoteErrorCode
  | Extract<
      ApiErrorCode,
      "PRICE_CHANGED" | "PAYMENT_METHOD_REQUIRED" | "BOOKING_REFERENCE_UNAVAILABLE"
    >;

/** Nothing is written when this is raised. Message and reason carry no personal data. */
export class BookingCreationError extends Error {
  override readonly name = "BookingCreationError";

  constructor(
    readonly code: BookingCreationErrorCode,
    readonly reason: string,
    message: string,
    readonly details: Readonly<{ total?: Money; temporary?: boolean }> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type CreatedBooking = Readonly<{
  bookingId: string;
  reference: string;
  status: BookingStatus;
  customerId: string;
  /** Current Payment of the booking, `PENDING` (VTC-031). */
  paymentId: string;
  total: Money;
}>;

/**
 * Collisions of a random 8-character reference are rare (32^8 values): a few attempts suffice,
 * and exhausting them points to a broken generator rather than bad luck.
 */
export const MAX_REFERENCE_ATTEMPTS = 5;

function parseRequest(input: unknown): ParsedRequest {
  const parsed = CreateBookingRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
      .join("; ");
    throw new BookingCreationError(
      "INVALID_INPUT",
      "invalid_request",
      `Invalid booking request: ${issues}`,
    );
  }
  return parsed.data;
}

function quotePlace(place: ParsedRequest["origin"]): QuoteRequest["origin"] {
  return place.placeId
    ? { placeId: place.placeId, label: place.label }
    : { lat: place.lat, lng: place.lng, label: place.label };
}

async function recompute(request: ParsedRequest, deps: CreateBookingDeps): Promise<Quote> {
  try {
    return await deps.quote({
      origin: quotePlace(request.origin),
      destination: quotePlace(request.destination),
      pickupLocalDateTime: request.pickupLocalDateTime,
      passengers: request.passengers,
      luggage: request.luggage,
    });
  } catch (error) {
    if (!(error instanceof QuoteError)) throw error;
    throw new BookingCreationError(
      error.code,
      error.reason,
      error.message,
      { temporary: error.temporary },
      { cause: error },
    );
  }
}

/** Unique violation (P2002) on `column`; the target is read from the error metadata. */
function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  return JSON.stringify(error.meta ?? {}).includes(column);
}

/** Unique violation on `Booking.reference`: another reference is drawn. */
function isReferenceCollision(error: unknown): boolean {
  return isUniqueViolationOn(error, "reference");
}

/**
 * Unique violation on `Payment.stripeSetupIntentId`: a concurrent request used the same
 * SetupIntent first (one booking per SetupIntent).
 */
function isSetupIntentReuse(error: unknown): boolean {
  return isUniqueViolationOn(error, "stripeSetupIntentId");
}

/** Wall-clock time without offset, stored in a `timestamp` column (read back with getUTC*). */
function localDateTimeColumn(localDateTime: string): Date {
  return new Date(`${localDateTime}:00.000Z`);
}

async function persist(
  request: ParsedRequest,
  quote: Quote,
  reference: string,
  paymentMethod: ConfirmedPaymentMethod,
  deps: CreateBookingDeps,
): Promise<CreatedBooking> {
  const snapshot = parsePricingSnapshot(quote.snapshot);
  const { customer, transport } = request;

  return deps.db.$transaction(async (tx) => {
    // Serialises concurrent requests for the same email, so that they share one guest profile.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer:${customer.email}`}, 0))::text AS locked`;

    // Matching rule: normalised email, guest profiles only (a profile linked to an account is
    // never taken over by an anonymous request). An existing profile is reused as is: no merge,
    // never rewritten by a guest (DEC-25); the submitted contact is copied onto the booking.
    const existing = await tx.customer.findFirst({
      where: { email: customer.email, userId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const customerId =
      existing?.id ??
      (
        await tx.customer.create({
          data: {
            name: customer.name,
            email: customer.email,
            phone: customer.phone ?? null,
            preferredLocale: customer.locale,
          },
          select: { id: true },
        })
      ).id;

    const booking = await tx.booking.create({
      data: {
        reference,
        customerId,
        // Contact of this trip as submitted (VTC-037): the driver calls this number, even when
        // the reused profile holds an older one. Never written to the audit trail (BR-60).
        contactName: customer.name,
        contactPhone: customer.phone ?? null,
        contactLocale: customer.locale,
        pickupLabel: request.origin.label,
        // Priced coordinates, resolved by the routing provider (VTC-035): the browser's are
        // never stored.
        pickupLat: quote.pricedOrigin.lat,
        pickupLng: quote.pricedOrigin.lng,
        pickupPlaceId: request.origin.placeId ?? null,
        dropoffLabel: request.destination.label,
        dropoffLat: quote.pricedDestination.lat,
        dropoffLng: quote.pricedDestination.lng,
        dropoffPlaceId: request.destination.placeId ?? null,
        pickupAt: new Date(snapshot.inputs.pickupAt),
        pickupLocalDateTime: localDateTimeColumn(snapshot.inputs.pickupLocalDateTime),
        pickupTimeZone: snapshot.inputs.timeZone,
        passengerCount: snapshot.inputs.passengers,
        luggageCount: snapshot.inputs.luggage,
        quotedDistanceMeters: snapshot.route.distanceMeters,
        quotedDurationSeconds: snapshot.route.durationSeconds,
        totalTtcCents: snapshot.totals.ttcCents,
        totalHtCents: snapshot.totals.htCents,
        vatCents: snapshot.totals.vatCents,
        currency: snapshot.totals.currency,
        pricingSnapshot: snapshot,
        pricingRuleId: snapshot.rule.id,
        pricingRuleVersion: snapshot.rule.version,
        status: INITIAL_BOOKING_STATUS,
        transportKind: transport?.kind ?? null,
        transportNumber: transport?.number ?? null,
        transportOrigin: transport?.origin ?? null,
        transportTerminal: transport?.terminal ?? null,
        transportScheduledAt: transport?.scheduledAt ? new Date(transport.scheduledAt) : null,
        customerNotes: request.customerNotes ?? null,
      },
      select: { id: true, reference: true, status: true, version: true },
    });

    await writeAuditLog(tx, {
      action: "booking.create",
      actorType: "CUSTOMER",
      actorId: customerId,
      entityId: booking.id,
      before: null,
      after: {
        bookingRef: booking.reference,
        status: booking.status,
        version: booking.version,
        totalTtcCents: snapshot.totals.ttcCents,
        currency: snapshot.totals.currency,
        pricingRuleVersion: snapshot.rule.version,
      },
      correlationId: currentCorrelationId() ?? null,
    });

    // First Payment of the booking (VTC-031): the saved payment method, nothing charged. Its
    // amount is the booking's TTC total; the charge at acceptance recomputes from the snapshot.
    const payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        status: INITIAL_PAYMENT_STATUS,
        amountCents: snapshot.totals.ttcCents,
        currency: snapshot.totals.currency,
        stripeCustomerId: paymentMethod.customerId,
        stripeSetupIntentId: paymentMethod.setupIntentId,
        stripePaymentMethodId: paymentMethod.paymentMethodId,
      },
      select: { id: true, status: true, version: true, amountCents: true, attempt: true },
    });
    // Part of the creation, not a later change: the booking keeps its initial version.
    await tx.booking.update({
      where: { id: booking.id },
      data: { currentPaymentId: payment.id },
      select: { id: true },
    });

    await writeAuditLog(tx, {
      action: "payment.create",
      actorType: "CUSTOMER",
      actorId: customerId,
      entityId: payment.id,
      before: null,
      after: {
        bookingRef: booking.reference,
        status: payment.status,
        version: payment.version,
        amountCents: payment.amountCents,
        currency: snapshot.totals.currency,
        attempt: payment.attempt,
      },
      correlationId: currentCorrelationId() ?? null,
    });

    return {
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status,
      customerId,
      paymentId: payment.id,
      total: { amountCents: snapshot.totals.ttcCents, currency: snapshot.totals.currency },
    };
  });
}

/**
 * Creates a `REQUESTED` booking. Checks run cheapest first: input, creation right, server price
 * (and the lead time it enforces), payment method, then the write. Every refusal is a
 * `BookingCreationError` (or the domain `InvalidBookingTransitionError`) and writes nothing.
 */
export async function createBooking(
  input: unknown,
  deps: CreateBookingDeps,
): Promise<CreatedBooking> {
  const request = parseRequest(input);
  assertCanCreateBooking("CUSTOMER");

  const quote = await recompute(request, deps);
  const displayed = request.displayedTotal;
  if (
    displayed.amountCents !== quote.total.amountCents ||
    displayed.currency !== quote.total.currency
  ) {
    logger().info({ reason: "price_changed" }, "booking refused: displayed price is stale");
    throw new BookingCreationError(
      "PRICE_CHANGED",
      "price_changed",
      "The recomputed price differs from the displayed price",
      { total: quote.total },
    );
  }

  const paymentMethod = await deps.paymentMethodGuard.confirmedPaymentMethod({
    paymentSetupId: request.paymentSetupId,
  });
  if (!paymentMethod) {
    throw new BookingCreationError(
      "PAYMENT_METHOD_REQUIRED",
      "no_confirmed_payment_method",
      "No confirmed payment method for this request",
    );
  }

  let created: CreatedBooking | undefined;
  for (let attempt = 1; created === undefined; attempt += 1) {
    const reference = deps.generateReference();
    try {
      created = await persist(request, quote, reference, paymentMethod, deps);
    } catch (error) {
      if (isSetupIntentReuse(error)) {
        logger().info({ reason: "already_used" }, "payment method refused");
        throw new BookingCreationError(
          "PAYMENT_METHOD_REQUIRED",
          "payment_setup_already_used",
          "This payment setup is already used by another booking",
          {},
          { cause: error },
        );
      }
      if (!isReferenceCollision(error)) throw error;
      logger().warn({ attempt }, "booking reference collision");
      if (attempt >= MAX_REFERENCE_ATTEMPTS) {
        throw new BookingCreationError(
          "BOOKING_REFERENCE_UNAVAILABLE",
          "reference_collisions",
          `No unique booking reference after ${MAX_REFERENCE_ATTEMPTS} attempts`,
          {},
          { cause: error },
        );
      }
    }
  }

  // Log the public reference only: no name, email, phone or address (BR-60).
  logger().info(
    { bookingRef: created.reference, pricingRuleVersion: quote.snapshot.rule.version },
    "booking requested",
  );

  if (deps.afterCommit) {
    try {
      await deps.afterCommit(created);
    } catch (error) {
      logger().warn(
        {
          bookingRef: created.reference,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "booking post-commit hook failed; the booking stands",
      );
    }
  }
  return created;
}
