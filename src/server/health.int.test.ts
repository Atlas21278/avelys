import { afterAll, describe, expect, it } from "vitest";

import { db } from "./db";
import { checkDatabase } from "./health";

// Runs against the real test database (vitest "integration" project), migrations applied.
describe("database (integration)", () => {
  afterAll(async () => {
    await db().$disconnect();
  });

  it("answers the readiness query", async () => {
    await expect(checkDatabase()).resolves.toEqual({ ok: true });
  });

  it("has the btree_gist extension required by the booking exclusion constraints", async () => {
    const rows = await db().$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`;
    expect(rows).toEqual([{ extname: "btree_gist" }]);
  });
});
