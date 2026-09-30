import { describe, expect, it } from "vitest";

import { correlationIdFrom, currentCorrelationId, runWithRequestContext } from "./request-context";

describe("correlationIdFrom", () => {
  it("reuses a well-formed upstream x-request-id", () => {
    const headers = new Headers({ "x-request-id": "abc123-def.456_ghi" });
    expect(correlationIdFrom(headers)).toBe("abc123-def.456_ghi");
  });

  it.each(["short", "has spaces in it", "<script>alert(1)</script>", "x".repeat(129)])(
    "replaces an unsafe upstream id (%s) with a fresh UUID",
    (incoming) => {
      const id = correlationIdFrom(new Headers({ "x-request-id": incoming }));
      expect(id).not.toBe(incoming);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it("generates a UUID when no header is present", () => {
    expect(correlationIdFrom(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ignores even a well-formed client id when asked to (public routes, VTC-045)", () => {
    const headers = new Headers({ "x-request-id": "abc123-def.456_ghi" });
    const id = correlationIdFrom(headers, { ignoreIncoming: true });
    expect(id).not.toBe("abc123-def.456_ghi");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("runWithRequestContext", () => {
  it("exposes the correlation id across async boundaries, only inside the context", async () => {
    expect(currentCorrelationId()).toBeUndefined();
    await runWithRequestContext({ correlationId: "req-12345678" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentCorrelationId()).toBe("req-12345678");
    });
    expect(currentCorrelationId()).toBeUndefined();
  });
});
