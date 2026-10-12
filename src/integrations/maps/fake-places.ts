/**
 * Test places of the end-to-end suite (VTC-048, docs/process/e2e.md). TEST DATA ONLY: shared by
 * the fake routing provider (server, `E2E_FAKE_ROUTING`) and the stub of the Places autocomplete
 * injected by Playwright in the browser, so that a suggestion chosen in the page is a place the
 * fake router knows. No Google identifier: the ids are prefixed `e2e-` and resolve nowhere else.
 *
 * Coordinates are those of the real landmarks (inside the provisional service area), and the
 * road distances and durations are fixed, plausible values: they make the test price
 * deterministic and are never used outside tests.
 */

export type FakePlace = Readonly<{
  placeId: string;
  mainText: string;
  secondaryText: string;
  lat: number;
  lng: number;
}>;

export const FAKE_PLACES = [
  {
    placeId: "e2e-place-opera",
    mainText: "Opéra Garnier",
    secondaryText: "Place de l'Opéra, 75009 Paris, France",
    lat: 48.871_946,
    lng: 2.331_601,
  },
  {
    placeId: "e2e-place-cdg-t2",
    mainText: "Aéroport Paris-Charles de Gaulle, Terminal 2",
    secondaryText: "95700 Roissy-en-France, France",
    lat: 49.004_47,
    lng: 2.571_04,
  },
  {
    placeId: "e2e-place-gare-de-lyon",
    mainText: "Gare de Lyon",
    secondaryText: "Place Louis-Armand, 75012 Paris, France",
    lat: 48.844_3,
    lng: 2.374_4,
  },
] as const satisfies readonly FakePlace[];

/** Fixed road legs between test places, both directions (metres, seconds). */
export const FAKE_ROAD_LEGS: Readonly<
  Record<string, Readonly<{ distanceMeters: number; durationSeconds: number }>>
> = {
  "e2e-place-opera|e2e-place-cdg-t2": { distanceMeters: 34_200, durationSeconds: 2_700 },
  "e2e-place-opera|e2e-place-gare-de-lyon": { distanceMeters: 4_100, durationSeconds: 900 },
  "e2e-place-gare-de-lyon|e2e-place-cdg-t2": { distanceMeters: 33_500, durationSeconds: 2_760 },
};

export function fakePlace(placeId: string): FakePlace | null {
  return FAKE_PLACES.find((place) => place.placeId === placeId) ?? null;
}

export function fakeRoadLeg(
  originPlaceId: string,
  destinationPlaceId: string,
): Readonly<{ distanceMeters: number; durationSeconds: number }> | null {
  return (
    FAKE_ROAD_LEGS[`${originPlaceId}|${destinationPlaceId}`] ??
    FAKE_ROAD_LEGS[`${destinationPlaceId}|${originPlaceId}`] ??
    null
  );
}
