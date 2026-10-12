import pg from "pg";

import { E2E_DATABASE_URL } from "./env";

/**
 * Read-only checks on the E2E database (VTC-048), for facts the pages do not show, such as how
 * many bookings exist for one customer email. Never a write.
 */
export type ChargedAmounts = {
  /** Server quote frozen on the booking (integer cents). */
  bookingTotalTtcCents: number;
  bookingCurrency: string;
  /** Amount of the current Payment (integer cents). */
  paymentAmountCents: number;
  paymentCurrency: string;
  stripePaymentIntentId: string | null;
};

/** Amounts of a booking and of its current Payment, by booking reference. */
export async function chargedAmounts(reference: string): Promise<ChargedAmounts> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<ChargedAmounts>(
      `SELECT b."totalTtcCents" AS "bookingTotalTtcCents", b.currency AS "bookingCurrency",
              p."amountCents" AS "paymentAmountCents", p.currency AS "paymentCurrency",
              p."stripePaymentIntentId" AS "stripePaymentIntentId"
         FROM "Booking" b
         JOIN "Payment" p ON p.id = b."currentPaymentId"
        WHERE b.reference = $1`,
      [reference],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`no booking with a current payment for ${reference}`);
    return row;
  } finally {
    await client.end();
  }
}

export async function countBookingsForEmail(email: string): Promise<number> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM "Booking" b
         JOIN "Customer" c ON c.id = b."customerId"
        WHERE lower(c.email) = lower($1)`,
      [email],
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}
