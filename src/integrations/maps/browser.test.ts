import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROVISIONAL_SERVICE_AREA } from "@/domain/geo/service-area";

import type { PlacesLibrary } from "./browser";

// Module state (the Maps script loads once per page): a fresh module for each test.
async function freshModule() {
  vi.resetModules();
  return import("./browser");
}

function fakeLibrary(suggestions: unknown[] | Error) {
  const tokens: object[] = [];
  const fetchAutocompleteSuggestions = vi.fn(() =>
    suggestions instanceof Error
      ? Promise.reject(suggestions)
      : Promise.resolve({ suggestions: suggestions as never[] }),
  );
  const library = {
    AutocompleteSessionToken: class {
      constructor() {
        tokens.push(this);
      }
    },
    AutocompleteSuggestion: { fetchAutocompleteSuggestions },
  } satisfies PlacesLibrary;
  return { library, tokens, fetchAutocompleteSuggestions };
}

const prediction = (placeId: string, text: string, main?: string, secondary?: string) => ({
  placePrediction: {
    placeId,
    text: { text },
    mainText: main ? { text: main } : null,
    secondaryText: secondary ? { text: secondary } : null,
  },
});

describe("createPlaceSuggestionSource", () => {
  it("asks Places for suggestions restricted to the service area, in the page language", async () => {
    const { createPlaceSuggestionSource } = await freshModule();
    const fake = fakeLibrary([
      prediction("p1", "Gare de Lyon, Paris, France", "Gare de Lyon", "Paris, France"),
    ]);
    const source = createPlaceSuggestionSource({
      language: "en",
      serviceArea: PROVISIONAL_SERVICE_AREA,
      loadPlaces: () => Promise.resolve(fake.library),
    });

    const found = await source.suggest("  gare de lyon ");

    expect(found).toEqual([
      {
        placeId: "p1",
        label: "Gare de Lyon, Paris, France",
        mainText: "Gare de Lyon",
        secondaryText: "Paris, France",
      },
    ]);
    expect(fake.fetchAutocompleteSuggestions).toHaveBeenCalledWith({
      input: "gare de lyon",
      sessionToken: fake.tokens[0],
      locationRestriction: { south: 41, west: -5.5, north: 51.5, east: 10 },
      language: "en",
    });
  });

  it("keeps one session token per session and opens a new one after a choice", async () => {
    const { createPlaceSuggestionSource } = await freshModule();
    const fake = fakeLibrary([]);
    const source = createPlaceSuggestionSource({
      language: "fr",
      serviceArea: PROVISIONAL_SERVICE_AREA,
      loadPlaces: () => Promise.resolve(fake.library),
    });

    await source.suggest("gar");
    await source.suggest("gare");
    expect(fake.tokens).toHaveLength(1);
    source.endSession();
    await source.suggest("orly");
    expect(fake.tokens).toHaveLength(2);
    const calls = fake.fetchAutocompleteSuggestions.mock.calls as unknown as [
      { sessionToken: object },
    ][];
    expect(calls[2]?.[0].sessionToken).toBe(fake.tokens[1]);
  });

  it("skips predictions without an id or a text, and falls back to the full text", async () => {
    const { createPlaceSuggestionSource } = await freshModule();
    const fake = fakeLibrary([
      { placePrediction: null },
      prediction("", "No id"),
      prediction("p2", "  "),
      prediction("p3", "Orly, France"),
    ]);
    const source = createPlaceSuggestionSource({
      language: "fr",
      serviceArea: PROVISIONAL_SERVICE_AREA,
      loadPlaces: () => Promise.resolve(fake.library),
    });

    expect(await source.suggest("orly")).toEqual([
      { placeId: "p3", label: "Orly, France", mainText: "Orly, France", secondaryText: null },
    ]);
  });

  it("does not call Places for a blank input", async () => {
    const { createPlaceSuggestionSource } = await freshModule();
    const loadPlaces = vi.fn();
    const source = createPlaceSuggestionSource({
      language: "fr",
      serviceArea: PROVISIONAL_SERVICE_AREA,
      loadPlaces,
    });
    expect(await source.suggest("   ")).toEqual([]);
    expect(loadPlaces).not.toHaveBeenCalled();
  });

  it("reports load and request failures as typed errors without the input", async () => {
    const { createPlaceSuggestionSource, MapsBrowserError } = await freshModule();
    const unloadable = createPlaceSuggestionSource({
      language: "fr",
      serviceArea: PROVISIONAL_SERVICE_AREA,
      loadPlaces: () => Promise.reject(new Error("network")),
    });
    await expect(unloadable.suggest("12 rue secrète")).rejects.toMatchObject({
      name: "MapsBrowserError",
      reason: "load_failed",
    });

    const failing = createPlaceSuggestionSource({
      language: "fr",
      serviceArea: PROVISIONAL_SERVICE_AREA,
      loadPlaces: () => Promise.resolve(fakeLibrary(new Error("OVER_QUERY_LIMIT")).library),
    });
    const error = await failing.suggest("12 rue secrète").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MapsBrowserError);
    expect(error).toMatchObject({ reason: "request_failed" });
    expect((error as Error).message).not.toContain("secrète");
  });
});

describe("loadPlacesLibrary", () => {
  type FakeScript = { src: string; async: boolean; onerror?: () => void; remove: () => void };
  let scripts: FakeScript[];
  let scope: Record<string, unknown>;

  beforeEach(() => {
    scripts = [];
    scope = {};
    vi.stubGlobal("window", scope);
    vi.stubGlobal("document", {
      createElement: () => {
        const script: FakeScript = { src: "", async: false, remove: vi.fn() };
        return script;
      },
      head: { append: (script: FakeScript) => scripts.push(script) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects the Maps script once, with the async loader, and resolves the Places library", async () => {
    const { loadPlacesLibrary } = await freshModule();
    const { library } = fakeLibrary([]);
    const importLibrary = vi.fn(() => Promise.resolve(library));

    const first = loadPlacesLibrary("browser-key-placeholder");
    const second = loadPlacesLibrary("browser-key-placeholder");
    expect(scripts).toHaveLength(1);
    const url = new URL(scripts[0]!.src);
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/js");
    expect(url.searchParams.get("key")).toBe("browser-key-placeholder");
    expect(url.searchParams.get("loading")).toBe("async");
    const callback = url.searchParams.get("callback")!;
    expect(scripts[0]!.async).toBe(true);

    scope.google = { maps: { importLibrary } };
    (scope[callback] as () => void)();

    await expect(first).resolves.toBe(library);
    expect(second).toBe(first);
    expect(importLibrary).toHaveBeenCalledWith("places");
  });

  it("rejects when the script cannot load, and allows a new attempt", async () => {
    const { loadPlacesLibrary } = await freshModule();
    const attempt = loadPlacesLibrary("k");
    scripts[0]!.onerror!();
    await expect(attempt).rejects.toMatchObject({ reason: "load_failed" });
    void loadPlacesLibrary("k").catch(() => undefined);
    expect(scripts).toHaveLength(2);
  });

  it("disables the autocomplete for the page when Google refuses the key", async () => {
    const { loadPlacesLibrary } = await freshModule();
    const attempt = loadPlacesLibrary("k");
    (scope.gm_authFailure as () => void)();
    await expect(attempt).rejects.toMatchObject({ reason: "auth_failed" });
    await expect(loadPlacesLibrary("k")).rejects.toMatchObject({ reason: "auth_failed" });
    expect(scripts).toHaveLength(1);
  });
});
