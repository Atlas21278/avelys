import type { ServiceArea } from "@/domain/geo/service-area";

/**
 * Browser-side Google Places autocomplete (VTC-046, ADR-0010): Places API (New) through the Maps
 * JavaScript API, with the restricted **browser** key. Suggestions only: no route, no price and
 * no geocoding happen in the browser; the chosen `placeId` goes to the server quote.
 *
 * The Maps script is loaded on first use with Google's documented dynamic library import
 * (`loading=async` + `importLibrary("places")`), so the page costs nothing until the visitor
 * types in a place field. Every suggestion session uses a Places session token, renewed after
 * each choice. Tests inject `loadPlaces` and never reach Google.
 */

/** One autocomplete suggestion, reduced to what the form needs. */
export type PlaceSuggestion = Readonly<{
  placeId: string;
  /** Full text of the suggestion, used as the place label sent to the quote. */
  label: string;
  mainText: string;
  secondaryText: string | null;
}>;

export interface PlaceSuggestionSource {
  /** Suggestions for `input`, restricted to the service area. Rejects with `MapsBrowserError`. */
  suggest(input: string): Promise<readonly PlaceSuggestion[]>;
  /** Ends the current Places session (a suggestion was chosen): the next query opens a new one. */
  endSession(): void;
}

export type MapsBrowserErrorReason = "load_failed" | "auth_failed" | "request_failed";

/** The autocomplete cannot be used; carries a technical reason only, never the input. */
export class MapsBrowserError extends Error {
  override readonly name = "MapsBrowserError";

  constructor(
    readonly reason: MapsBrowserErrorReason,
    options?: { cause?: unknown },
  ) {
    super(`Place autocomplete unavailable (${reason})`, options);
  }
}

type FormattableText = { text: string } | null | undefined;

type PlacePrediction = {
  placeId: string;
  text: FormattableText;
  mainText?: FormattableText;
  secondaryText?: FormattableText;
};

/** The subset of `google.maps.PlacesLibrary` used here (no @types dependency). */
export interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string;
      sessionToken?: object;
      locationRestriction?: { south: number; west: number; north: number; east: number };
      language?: string;
    }): Promise<{
      suggestions: ReadonlyArray<{ placePrediction?: PlacePrediction | null }>;
    }>;
  };
}

type MapsWindow = {
  google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
  gm_authFailure?: () => void;
  [callback: string]: unknown;
};

const MAPS_SCRIPT_URL = "https://maps.googleapis.com/maps/api/js";
const READY_CALLBACK = "__avelysMapsReady";

let loading: Promise<PlacesLibrary> | undefined;
let authFailed = false;

/**
 * Loads the Maps JavaScript API once per page and resolves the Places library. A failed load can
 * be retried; an invalid or unauthorised key (`gm_authFailure`) disables the autocomplete for
 * the page.
 */
export function loadPlacesLibrary(apiKey: string): Promise<PlacesLibrary> {
  if (authFailed) return Promise.reject(new MapsBrowserError("auth_failed"));
  loading ??= new Promise<PlacesLibrary>((resolve, reject) => {
    const scope = window as unknown as MapsWindow;
    scope.gm_authFailure = () => {
      authFailed = true;
      reject(new MapsBrowserError("auth_failed"));
    };
    scope[READY_CALLBACK] = () => {
      const importLibrary = scope.google?.maps?.importLibrary;
      if (!importLibrary) {
        reject(new MapsBrowserError("load_failed"));
        return;
      }
      importLibrary("places").then(
        (library) => resolve(library as PlacesLibrary),
        (error: unknown) => reject(new MapsBrowserError("load_failed", { cause: error })),
      );
    };
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      loading: "async",
      callback: READY_CALLBACK,
    });
    const script = document.createElement("script");
    script.src = `${MAPS_SCRIPT_URL}?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      script.remove();
      loading = undefined;
      reject(new MapsBrowserError("load_failed"));
    };
    document.head.append(script);
  });
  return loading;
}

function toSuggestion(prediction: PlacePrediction): PlaceSuggestion | null {
  const label = prediction.text?.text.trim() ?? "";
  if (!prediction.placeId || !label) return null;
  const main = prediction.mainText?.text.trim();
  const secondary = prediction.secondaryText?.text.trim();
  return {
    placeId: prediction.placeId,
    label,
    mainText: main || label,
    secondaryText: secondary || null,
  };
}

export type PlaceSuggestionOptions = Readonly<{
  /** Language of the suggestions (the page locale). */
  language: string;
  /** Suggestions are restricted to this rectangle (`ROUTING_SERVICE_AREA`, provisional, DEC-26). */
  serviceArea: ServiceArea;
  loadPlaces: () => Promise<PlacesLibrary>;
}>;

export function createPlaceSuggestionSource(
  options: PlaceSuggestionOptions,
): PlaceSuggestionSource {
  let sessionToken: object | undefined;

  return {
    async suggest(input) {
      const text = input.trim();
      if (!text) return [];
      let library: PlacesLibrary;
      try {
        library = await options.loadPlaces();
      } catch (error) {
        if (error instanceof MapsBrowserError) throw error;
        throw new MapsBrowserError("load_failed", { cause: error });
      }
      sessionToken ??= new library.AutocompleteSessionToken();
      const { south, west, north, east } = options.serviceArea;
      try {
        const { suggestions } = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: text,
          sessionToken,
          locationRestriction: { south, west, north, east },
          language: options.language,
        });
        return suggestions.flatMap(({ placePrediction }) => {
          const suggestion = placePrediction ? toSuggestion(placePrediction) : null;
          return suggestion ? [suggestion] : [];
        });
      } catch (error) {
        throw new MapsBrowserError(authFailed ? "auth_failed" : "request_failed", {
          cause: error,
        });
      }
    },
    endSession() {
      sessionToken = undefined;
    },
  };
}

/** Production source: the Maps script loaded with the browser key. */
export function googlePlaceSuggestions(
  apiKey: string,
  options: Omit<PlaceSuggestionOptions, "loadPlaces">,
): PlaceSuggestionSource {
  return createPlaceSuggestionSource({ ...options, loadPlaces: () => loadPlacesLibrary(apiKey) });
}
