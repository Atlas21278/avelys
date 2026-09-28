import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabase = vi.fn();
const logError = vi.fn();

vi.mock("@/server/health", () => ({ checkDatabase: () => checkDatabase() }));
vi.mock("@/lib/logger", () => ({ logger: () => ({ error: logError }) }));

const { GET } = await import("./route");

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/health/ready", { headers });
}

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    checkDatabase.mockReset();
    logError.mockReset();
  });

  it("answers 200 when the database responds", async () => {
    checkDatabase.mockResolvedValue({ ok: true });
    const response = await GET(request({ "x-request-id": "probe-00000001" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("probe-00000001");
  });

  it("answers 503 with a stable code and no internal detail when the database fails", async () => {
    const internal = new Error("connect ECONNREFUSED 127.0.0.1:5433 password=secret");
    checkDatabase.mockResolvedValue({ ok: false, reason: "error", error: internal });

    const response = await GET(request());
    const body = (await response.json()) as {
      error: { code: string; message: string; correlationId: string };
    };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(body.error.correlationId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|5433|password|secret/);
    expect(logError).toHaveBeenCalledOnce();
  });

  it("answers 503 on timeout", async () => {
    checkDatabase.mockResolvedValue({ ok: false, reason: "timeout" });
    const response = await GET(request());
    expect(response.status).toBe(503);
  });
});
