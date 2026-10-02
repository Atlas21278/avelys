/**
 * Shared schemas of a public booking request (VTC-028, VTC-047): the server parses the request
 * with them (`src/server/booking/create-booking.ts`) and the booking form validates the same
 * fields before sending, so the browser and the server never disagree on what is valid. Pure Zod,
 * no I/O. None of them accepts an amount (BR-12).
 */

import { z } from "zod";

import { ContactEmailSchema } from "./contact";

/** Display label of a place: stored on the booking, never priced, never logged. */
export const PlaceLabelSchema = z.string().trim().min(1).max(200);

const LatitudeSchema = z.number().min(-90).max(90);
const LongitudeSchema = z.number().min(-180).max(180);
const PlaceIdSchema = z.string().trim().min(1).max(1024);

/**
 * A place of the booking form: a Places id chosen from the autocomplete, or coordinates, with its
 * display label — as for the quote. The route is computed from the place id when present (any
 * coordinates sent with it are then ignored), from the coordinates otherwise. The booking stores
 * the end points of the priced route, never these inputs (VTC-035).
 */
export const BookingPlaceSchema = z.union([
  z.strictObject({
    label: PlaceLabelSchema,
    placeId: PlaceIdSchema,
    lat: LatitudeSchema.optional(),
    lng: LongitudeSchema.optional(),
  }),
  z.strictObject({ label: PlaceLabelSchema, lat: LatitudeSchema, lng: LongitudeSchema }),
]);

const OptionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/** Loose phone format: digits, spaces, dots, dashes and brackets, optional leading `+`. */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 .()-]{5,31}$/);

export const CUSTOMER_NAME_MAX_LENGTH = 200;
export const CUSTOMER_NOTES_MAX_LENGTH = 1_000;

/** Contact of the request, copied on the booking (DEC-25). */
export const BookingCustomerSchema = z.strictObject({
  name: z.string().trim().min(1).max(CUSTOMER_NAME_MAX_LENGTH),
  email: ContactEmailSchema,
  phone: PhoneSchema.optional(),
  locale: z.enum(["fr", "en"]).default("fr"),
});

export const CustomerNotesSchema = OptionalText(CUSTOMER_NOTES_MAX_LENGTH);

export const TRANSPORT_KINDS = ["FLIGHT", "TRAIN"] as const;
export type TransportKind = (typeof TRANSPORT_KINDS)[number];

/** Airport or station arrival (BR-34): scheduled time distinct from the pickup time. */
export const BookingTransportSchema = z.strictObject({
  kind: z.enum(TRANSPORT_KINDS),
  number: OptionalText(32),
  origin: OptionalText(120),
  terminal: OptionalText(120),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});
