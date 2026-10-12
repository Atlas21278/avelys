import pg from "pg";

import { E2E_DATABASE_URL } from "./env";

/**
 * Read-only checks on the E2E database (VTC-048), for facts the pages do not show, such as how
 * many bookings exist for one customer email. Never a write.
 */
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
