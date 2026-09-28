import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy, { config } from "./proxy";

const ORIGIN = "http://localhost:3000";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

/** Internal path the request is served from, or null when the proxy does not rewrite. */
function rewrittenTo(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

function redirectedTo(response: Response): string | null {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : null;
}

describe("locale resolution", () => {
  it.each([
    ["/", "/fr"],
    ["/entreprises", "/fr/entreprises"],
    ["/flotte", "/fr/flotte"],
    ["/reservation", "/fr/reservation"],
  ])("serves %s in French without prefix", (path, internal) => {
    const response = proxy(request(path));
    expect(redirectedTo(response)).toBeNull();
    expect(rewrittenTo(response)).toBe(internal);
  });

  it.each([
    ["/en", "/en"],
    ["/en/business", "/en/entreprises"],
    ["/en/fleet", "/en/flotte"],
    ["/en/about", "/en/a-propos"],
    ["/en/booking", "/en/reservation"],
    ["/en/account", "/en/compte"],
  ])("serves %s in English with its translated slug", (path, internal) => {
    const response = proxy(request(path));
    expect(redirectedTo(response)).toBeNull();
    // An identical internal path needs no rewrite.
    expect(rewrittenTo(response) ?? path).toBe(internal);
  });

  it("does not redirect / to English based on the browser language", () => {
    const response = proxy(request("/", { "accept-language": "en-US,en;q=0.9" }));
    expect(redirectedTo(response)).toBeNull();
    expect(rewrittenTo(response)).toBe("/fr");
  });

  it("sets no locale cookie", () => {
    const response = proxy(request("/en/fleet", { "accept-language": "en" }));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["/fr", "/"],
    ["/fr/flotte", "/flotte"],
  ])("redirects the explicit default prefix %s to %s", (path, target) => {
    expect(redirectedTo(proxy(request(path)))).toBe(target);
  });

  it("redirects an English URL using a French slug to the translated one", () => {
    expect(redirectedTo(proxy(request("/en/flotte")))).toBe("/en/fleet");
  });
});

describe("proxy matcher", () => {
  it.each(["/", "/en", "/en/fleet", "/entreprises", "/designer-weddings"])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/api/health",
    "/api/health/ready",
    "/_next/static/chunk.js",
    "/design",
    "/admin",
    "/admin/bookings",
    "/icon.svg",
  ])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
