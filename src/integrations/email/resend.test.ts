import type { CreateEmailOptions, CreateEmailRequestOptions, CreateEmailResponse } from "resend";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createResendClient,
  createResendEmailSender,
  mapResendError,
  providerIdempotencyKey,
  type ResendEmailsClient,
  type ResendSenderOptions,
} from "./resend";
import type { EmailMessage } from "./sender";

// Placeholder built at runtime: no key-like literal lives in the repository.
const FAKE_KEY = ["re", "unitTestPlaceholder0000"].join("_");
const RECIPIENT = "guest.customer@example.com";

const message: EmailMessage = {
  to: RECIPIENT,
  subject: "Sujet",
  html: "<p>Bonjour</p>",
  text: "Bonjour",
  idempotencyKey: providerIdempotencyKey("booking:b1:test"),
};

type SendFn = (
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions,
) => Promise<CreateEmailResponse>;

function fakeClient(send: SendFn): { client: ResendEmailsClient; send: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(send);
  return { client: { emails: { send: spy } }, send: spy };
}

function sender(send: SendFn, overrides: Partial<ResendSenderOptions> = {}) {
  const fake = fakeClient(send);
  const createClient = vi.fn(() => fake.client);
  return {
    ...fake,
    createClient,
    sender: createResendEmailSender({
      apiKey: () => FAKE_KEY,
      from: () => "Avelys <bookings@example.com>",
      createClient,
      ...overrides,
    }),
  };
}

const ok = (id: string): CreateEmailResponse => ({ data: { id }, error: null, headers: null });
const failure = (name: string, statusCode: number | null): CreateEmailResponse =>
  ({
    data: null,
    error: { name, statusCode, message: `refused for ${RECIPIENT}` },
    headers: null,
  }) as CreateEmailResponse;

describe("Resend email sender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the message with the idempotency key and returns the provider id", async () => {
    const { sender: s, send } = sender(async () => ok("msg_123"), {
      replyTo: () => "contact@example.com",
    });

    await expect(s.send(message)).resolves.toEqual({ ok: true, messageId: "msg_123" });
    expect(send).toHaveBeenCalledOnce();
    const [payload, options] = send.mock.calls[0]!;
    expect(payload).toEqual({
      from: "Avelys <bookings@example.com>",
      to: [RECIPIENT],
      subject: "Sujet",
      html: "<p>Bonjour</p>",
      text: "Bonjour",
      replyTo: "contact@example.com",
    });
    expect(options).toEqual({ idempotencyKey: message.idempotencyKey });
  });

  it("omits the reply-to address when none is configured", async () => {
    const { sender: s, send } = sender(async () => ok("msg_1"));
    await s.send(message);
    expect(send.mock.calls[0]![0]).not.toHaveProperty("replyTo");
  });

  it("is not configured without a key or a valid sender, and never builds a client then", async () => {
    for (const overrides of [
      { apiKey: () => undefined },
      { apiKey: () => "" },
      { from: () => undefined },
      { from: () => "not an address" },
    ]) {
      const { sender: s, createClient } = sender(async () => ok("msg_1"), overrides);
      await expect(s.send(message)).resolves.toEqual({ ok: false, code: "EMAIL_NOT_CONFIGURED" });
      expect(createClient).not.toHaveBeenCalled();
    }
  });

  it("maps a provider error to a code, without the provider message", async () => {
    const { sender: s } = sender(async () => failure("validation_error", 422));
    const result = await s.send(message);
    expect(result).toEqual({ ok: false, code: "EMAIL_REJECTED" });
    expect(JSON.stringify(result)).not.toContain(RECIPIENT);
  });

  it("times out after the configured delay", async () => {
    const { sender: s } = sender(() => new Promise<CreateEmailResponse>(() => {}), {
      timeoutMs: 20,
    });
    await expect(s.send(message)).resolves.toEqual({ ok: false, code: "EMAIL_TIMEOUT" });
  });

  it("never throws, even if the client does", async () => {
    const { sender: s } = sender(async () => {
      throw new Error(`boom ${RECIPIENT}`);
    });
    await expect(s.send(message)).resolves.toEqual({ ok: false, code: "EMAIL_PROVIDER_ERROR" });
  });

  it("treats an answer without message id as a provider error", async () => {
    const { sender: s } = sender(
      async () => ({ data: null, error: null, headers: null }) as unknown as CreateEmailResponse,
    );
    await expect(s.send(message)).resolves.toEqual({ ok: false, code: "EMAIL_PROVIDER_ERROR" });
  });

  it("reuses the client while the key is unchanged", async () => {
    const { sender: s, createClient } = sender(async () => ok("msg_1"));
    await s.send(message);
    await s.send(message);
    expect(createClient).toHaveBeenCalledOnce();
  });
});

describe("mapResendError", () => {
  it.each([
    ["missing_api_key", 401, "EMAIL_AUTH_FAILED"],
    ["invalid_api_key", 403, "EMAIL_AUTH_FAILED"],
    ["restricted_api_key", 401, "EMAIL_AUTH_FAILED"],
    ["validation_error", 422, "EMAIL_REJECTED"],
    ["invalid_from_address", 422, "EMAIL_REJECTED"],
    ["missing_required_field", 422, "EMAIL_REJECTED"],
    ["rate_limit_exceeded", 429, "EMAIL_RATE_LIMITED"],
    ["daily_quota_exceeded", 429, "EMAIL_RATE_LIMITED"],
    ["concurrent_idempotent_requests", 409, "EMAIL_IDEMPOTENCY_CONFLICT"],
    ["invalid_idempotent_request", 409, "EMAIL_IDEMPOTENCY_CONFLICT"],
    ["application_error", null, "EMAIL_NETWORK_ERROR"],
    ["application_error", 500, "EMAIL_PROVIDER_ERROR"],
    ["internal_server_error", 500, "EMAIL_PROVIDER_ERROR"],
    ["unknown_future_error", 401, "EMAIL_AUTH_FAILED"],
    ["unknown_future_error", 429, "EMAIL_RATE_LIMITED"],
    ["unknown_future_error", 400, "EMAIL_PROVIDER_ERROR"],
  ] as const)("%s (%s) → %s", (name, statusCode, code) => {
    expect(mapResendError({ name: name as never, statusCode })).toBe(code);
  });
});

describe("providerIdempotencyKey", () => {
  it("is stable, bounded and does not reveal the deduplication key", () => {
    const key = providerIdempotencyKey("booking:abc:payment-action-required:1");
    expect(key).toBe(providerIdempotencyKey("booking:abc:payment-action-required:1"));
    expect(key).not.toBe(providerIdempotencyKey("booking:abc:payment-action-required:2"));
    expect(key).toMatch(/^avelys-notification-[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(256);
    expect(key).not.toContain("abc");
  });
});

describe("real Resend client (fetch stubbed, no network)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function realSender() {
    return createResendEmailSender({
      apiKey: () => FAKE_KEY,
      from: () => "bookings@example.com",
      createClient: createResendClient,
    });
  }

  it("sends the idempotency key header and reads the message id", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ id: "msg_real" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(realSender().send(message)).resolves.toEqual({
      ok: true,
      messageId: "msg_real",
    });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(message.idempotencyKey);
  });

  it("maps an API error and prints nothing that could quote the recipient", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { name: "validation_error", statusCode: 422, message: `Invalid \`to\`: ${RECIPIENT}` },
        { status: 422 },
      ),
    );

    await expect(realSender().send(message)).resolves.toEqual({
      ok: false,
      code: "EMAIL_REJECTED",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("reports an unreachable API as a network error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(realSender().send(message)).resolves.toEqual({
      ok: false,
      code: "EMAIL_NETWORK_ERROR",
    });
  });
});
