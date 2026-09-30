import { describe, expect, it, vi } from "vitest";

const serverEnv = vi.fn(() => ({
  RESEND_API_KEY: undefined as string | undefined,
  EMAIL_FROM: undefined as string | undefined,
  EMAIL_REPLY_TO: undefined as string | undefined,
}));

vi.mock("@/lib/env/server", () => ({ serverEnv: () => serverEnv() }));

const { emailSender } = await import("./index");

describe("email adapter wiring", () => {
  it("reads no environment at import or when the sender is created", () => {
    emailSender();
    expect(serverEnv).not.toHaveBeenCalled();
  });

  it("returns EMAIL_NOT_CONFIGURED on send without a key, without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await expect(
        emailSender().send({
          to: "guest@example.com",
          subject: "s",
          html: "<p>h</p>",
          text: "h",
          idempotencyKey: "k",
        }),
      ).resolves.toEqual({ ok: false, code: "EMAIL_NOT_CONFIGURED" });
      expect(serverEnv).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
