import { describe, expect, it } from "vitest";

import en from "./messages/en.json";
import fr from "./messages/fr.json";
import { routing } from "./routing";

type Catalogue = { [key: string]: string | Catalogue };

/** Flattens a message catalogue into `namespace.key` paths mapped to their string value. */
function flatten(catalogue: Catalogue, prefix = ""): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const [key, value] of Object.entries(catalogue)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      for (const [nested, leaf] of flatten(value, path)) entries.set(nested, leaf);
    } else {
      entries.set(path, value);
    }
  }
  return entries;
}

const catalogues: Record<string, Map<string, unknown>> = { fr: flatten(fr), en: flatten(en) };

describe("message catalogues", () => {
  it("exist for every supported locale", () => {
    expect(Object.keys(catalogues).sort()).toEqual([...routing.locales].sort());
  });

  it("define exactly the same keys in French and English", () => {
    const frKeys = [...catalogues.fr!.keys()].sort();
    const enKeys = [...catalogues.en!.keys()].sort();
    expect(enKeys).toEqual(frKeys);
  });

  it.each(Object.entries(catalogues))("has only non-empty strings in %s", (_locale, messages) => {
    expect(messages.size).toBeGreaterThan(0);
    for (const [key, value] of messages) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim(), key).not.toBe("");
    }
  });

  it("has a name for every locale in the language selector", () => {
    for (const messages of Object.values(catalogues)) {
      for (const locale of routing.locales) {
        expect(messages.has(`LocaleSwitcher.${locale}`), locale).toBe(true);
      }
    }
  });
});
