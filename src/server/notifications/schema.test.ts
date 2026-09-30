import { describe, expect, it } from "vitest";

import { NotificationStatus, Prisma } from "@/generated/prisma/browser";

// Notification model (VTC-043): no database needed.
describe("notification schema", () => {
  it("has the three statuses of the ticket", () => {
    expect(Object.values(NotificationStatus)).toEqual(["PENDING", "SENT", "FAILED"]);
  });

  it("stores no address and no content (BR-60)", () => {
    const columns = Object.values(Prisma.NotificationScalarFieldEnum);
    expect(
      columns.filter((name) => /email|address|recipient|^to$|subject|body|html|text/i.test(name)),
    ).toEqual([]);
  });
});
