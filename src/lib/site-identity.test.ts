import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";

import { SITE_IDENTITY_DECISIONS, SITE_IDENTITY_FIELDS, siteIdentity } from "./site-identity";

describe("siteIdentity", () => {
  it("configures exactly the listed fields", () => {
    expect(Object.keys(siteIdentity).sort()).toEqual([...SITE_IDENTITY_FIELDS].sort());
  });

  it("holds either a confirmed non-empty value or null (shown as provisional)", () => {
    for (const field of SITE_IDENTITY_FIELDS) {
      const value = siteIdentity[field];
      if (value !== null) expect(value.trim(), field).not.toBe("");
    }
  });

  it("names the open decisions behind the placeholders", () => {
    expect(SITE_IDENTITY_DECISIONS).toBe("DEC-08 / DEC-20");
  });

  it("has a footer label for every field in both languages", () => {
    for (const catalogue of [fr, en]) {
      for (const field of SITE_IDENTITY_FIELDS) {
        expect(catalogue.Site.footer.identity[field], field).toBeTruthy();
      }
    }
  });
});
