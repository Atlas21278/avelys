import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LEGAL_NAV, SITE_NAV } from "@/components/site/nav";

import { getPathname } from "./navigation";
import { routing, type AppPathname } from "./routing";

const localeDir = fileURLToPath(new URL("../app/[locale]", import.meta.url));

// Declared in the routing table, page delivered by a later ticket: the customer account
// comes with the magic link (EPIC-13). Remove from this list when its page exists.
const PENDING_PAGES: readonly AppPathname[] = ["/compte"];

const pathnames = Object.keys(routing.pathnames) as AppPathname[];

function pageFile(pathname: AppPathname): string {
  return `${localeDir}${pathname === "/" ? "" : pathname}/page.tsx`;
}

/** Internal pathnames of the static pages found under `src/app/[locale]`. */
function pagesOnDisk(dir = localeDir, prefix = ""): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") pages.push(prefix || "/");
    // Private folders (`_components`) and dynamic segments (the 404 catch-all) are not pages.
    if (entry.isDirectory() && !/^[_[(]/.test(entry.name)) {
      pages.push(...pagesOnDisk(`${dir}/${entry.name}`, `${prefix}/${entry.name}`));
    }
  }
  return pages;
}

describe("public routes", () => {
  it.each(pathnames.filter((pathname) => !PENDING_PAGES.includes(pathname)))(
    "%s has a page",
    (pathname) => {
      expect(existsSync(pageFile(pathname)), pageFile(pathname)).toBe(true);
    },
  );

  it("declares every page in the routing table", () => {
    expect(pagesOnDisk().sort()).toEqual(
      pathnames.filter((pathname) => !PENDING_PAGES.includes(pathname)).sort(),
    );
  });

  it.each(pathnames)("%s has an English URL under /en", (pathname) => {
    const en = getPathname({ href: pathname, locale: "en" });
    expect(en === "/en" || en.startsWith("/en/")).toBe(true);
    expect(getPathname({ href: pathname, locale: "fr" })).toBe(pathname);
  });

  it("gives English slugs to the legal pages", () => {
    expect(LEGAL_NAV.map(({ href }) => getPathname({ href, locale: "en" }))).toEqual([
      "/en/legal-notice",
      "/en/privacy",
      "/en/cookies",
      "/en/terms",
    ]);
  });

  it("links the header and footer only to pages that exist", () => {
    for (const { href } of [...SITE_NAV, ...LEGAL_NAV, { href: "/reservation" as const }]) {
      expect(existsSync(pageFile(href)), href).toBe(true);
    }
  });
});
