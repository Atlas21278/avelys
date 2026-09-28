/**
 * Service area sanity check on routed points (VTC-039). Pure: no I/O, no configuration read.
 *
 * This is a guard against provider or geocoding errors (a place resolved to the wrong country,
 * a missing coordinate read as 0), not the commercial operating zone: that zone is not decided.
 * The area is therefore deliberately broad and configurable, and its default is PROVISIONAL.
 */

import { z } from "zod";

/** A latitude/longitude rectangle, WGS84 degrees, edges included. Never crosses the antimeridian. */
export type ServiceArea = Readonly<{
  south: number;
  west: number;
  north: number;
  east: number;
}>;

/**
 * PROVISIONAL default (VTC-039): the bounding box of metropolitan France, Corsica included.
 * Broad on purpose — it only rejects points that cannot belong to a Paris-based trip. Not a
 * business rule: replace it through `ROUTING_SERVICE_AREA` once the operating zone is decided.
 */
export const PROVISIONAL_SERVICE_AREA: ServiceArea = Object.freeze({
  south: 41,
  west: -5.5,
  north: 51.5,
  east: 10,
});

const DECIMAL_DEGREES = /^-?\d+(\.\d+)?$/;

/** `south,west,north,east` in decimal degrees, e.g. `41,-5.5,51.5,10`. */
export const ServiceAreaSchema = z
  .string()
  .transform((value, ctx) => {
    const numbers = value
      .split(",")
      .map((part) => part.trim())
      .map((part) => (DECIMAL_DEGREES.test(part) ? Number(part) : Number.NaN));
    const [south, west, north, east] = numbers;
    if (
      numbers.length !== 4 ||
      south === undefined ||
      west === undefined ||
      north === undefined ||
      east === undefined ||
      numbers.some((n) => !Number.isFinite(n))
    ) {
      ctx.addIssue({ code: "custom", message: "Expected south,west,north,east in degrees" });
      return z.NEVER;
    }
    return { south, west, north, east };
  })
  .pipe(
    z
      .strictObject({
        south: z.number().min(-90).max(90),
        west: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
      })
      .refine((area) => area.south < area.north && area.west < area.east, {
        message: "Expected south < north and west < east",
      }),
  );

export type ServiceAreaCheck = "INSIDE" | "NULL_ISLAND" | "OUTSIDE_SERVICE_AREA";

/**
 * Classifies a routed point. `(0, 0)` ("Null Island") is always refused, whatever the area: it
 * is what a missing coordinate reads as, never a real pickup or drop-off.
 */
export function checkServiceArea(
  point: Readonly<{ lat: number; lng: number }>,
  area: ServiceArea,
): ServiceAreaCheck {
  if (point.lat === 0 && point.lng === 0) return "NULL_ISLAND";
  const inside =
    point.lat >= area.south &&
    point.lat <= area.north &&
    point.lng >= area.west &&
    point.lng <= area.east;
  return inside ? "INSIDE" : "OUTSIDE_SERVICE_AREA";
}
