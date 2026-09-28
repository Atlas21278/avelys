import { describe, expect, it } from "vitest";

import { localeAlternates } from "./alternates";
import { routing } from "./routing";

describe("localeAlternates", () => {
  it("links the French and English home pages both ways", () => {
    expect(localeAlternates("/", "fr")).toEqual({
      canonical: "/",
      languages: { fr: "/", en: "/en", "x-default": "/" },
    });
    expect(localeAlternates("/", "en")).toEqual({
      canonical: "/en",
      languages: { fr: "/", en: "/en", "x-default": "/" },
    });
  });

  it("uses translated English slugs", () => {
    expect(localeAlternates("/entreprises", "en")).toEqual({
      canonical: "/en/business",
      languages: { fr: "/entreprises", en: "/en/business", "x-default": "/entreprises" },
    });
  });

  it("gives every page the same reciprocal set whatever the current locale", () => {
    for (const href of Object.keys(routing.pathnames) as (keyof typeof routing.pathnames)[]) {
      const fr = localeAlternates(href, "fr");
      const en = localeAlternates(href, "en");
      expect(en.languages).toEqual(fr.languages);
      expect(Object.keys(fr.languages ?? {}).sort()).toEqual(["en", "fr", "x-default"]);
      expect(fr.canonical).toBe((fr.languages as Record<string, string>).fr);
      expect(en.canonical).toBe((en.languages as Record<string, string>).en);
    }
  });
});
