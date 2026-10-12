/**
 * Fake Maps JavaScript API of the end-to-end suite (VTC-048, docs/process/e2e.md). TEST ONLY:
 * served by Playwright in place of https://maps.googleapis.com/maps/api/js (route interception,
 * `e2e/base.ts`): Google is never called. The serving fixture prepends the test places
 * (`window.__AVELYS_FAKE_PLACES__`, from src/integrations/maps/fake-places.ts), the same ones the
 * fake server routing knows.
 *
 * It implements what src/integrations/maps/browser.ts uses: `google.maps.importLibrary("places")`
 * with `AutocompleteSessionToken` and `AutocompleteSuggestion.fetchAutocompleteSuggestions`, and
 * calls the loader's `callback` like the real script.
 */
(function installFakePlaces() {
  const places = window.__AVELYS_FAKE_PLACES__ ?? [];
  const fold = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  class AutocompleteSessionToken {}

  const AutocompleteSuggestion = {
    async fetchAutocompleteSuggestions({ input }) {
      const query = fold(input.trim());
      const suggestions = places
        .filter((place) => fold(`${place.mainText} ${place.secondaryText}`).includes(query))
        .map((place) => ({
          placePrediction: {
            placeId: place.placeId,
            text: { text: `${place.mainText}, ${place.secondaryText}` },
            mainText: { text: place.mainText },
            secondaryText: { text: place.secondaryText },
          },
        }));
      return { suggestions };
    },
  };

  window.google = window.google ?? {};
  window.google.maps = {
    importLibrary: async (name) => {
      if (name !== "places") throw new Error(`fake Maps: library ${name} not available`);
      return { AutocompleteSessionToken, AutocompleteSuggestion };
    },
  };

  const source = document.currentScript?.src;
  const callback = source ? new URL(source).searchParams.get("callback") : null;
  if (callback && typeof window[callback] === "function") window[callback]();
})();
