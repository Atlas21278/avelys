import { describe, expect, it } from "vitest";

import { checkServiceArea, PROVISIONAL_SERVICE_AREA, ServiceAreaSchema } from "./service-area";

const AREA = PROVISIONAL_SERVICE_AREA;

describe("checkServiceArea", () => {
  it.each([
    ["Paris (Étoile)", { lat: 48.8738, lng: 2.295 }],
    ["Paris-CDG airport", { lat: 49.0097, lng: 2.5479 }],
    ["Nice", { lat: 43.7102, lng: 7.262 }],
    ["Brest", { lat: 48.3904, lng: -4.4861 }],
    ["a point on the south-west corner", { lat: 41, lng: -5.5 }],
    ["a point on the north-east corner", { lat: 51.5, lng: 10 }],
    ["a point on the Greenwich meridian", { lat: 48.8, lng: 0 }],
  ])("accepts %s", (_label, point) => {
    expect(checkServiceArea(point, AREA)).toBe("INSIDE");
  });

  it.each([
    ["New York", { lat: 40.7128, lng: -74.006 }],
    ["Paris, Texas", { lat: 33.6609, lng: -95.5555 }],
    ["latitude and longitude swapped", { lat: 2.295, lng: 48.8738 }],
    ["just south of the area", { lat: 40.9999, lng: 2 }],
    ["just east of the area", { lat: 48, lng: 10.0001 }],
    ["a missing latitude read as 0", { lat: 0, lng: 2.295 }],
  ])("refuses %s", (_label, point) => {
    expect(checkServiceArea(point, AREA)).toBe("OUTSIDE_SERVICE_AREA");
  });

  it("always refuses (0, 0), even with a world-wide area", () => {
    const world = { south: -90, west: -180, north: 90, east: 180 };
    expect(checkServiceArea({ lat: 0, lng: 0 }, AREA)).toBe("NULL_ISLAND");
    expect(checkServiceArea({ lat: 0, lng: 0 }, world)).toBe("NULL_ISLAND");
    expect(checkServiceArea({ lat: -0, lng: 0 }, world)).toBe("NULL_ISLAND");
    expect(checkServiceArea({ lat: 0.0001, lng: 0 }, world)).toBe("INSIDE");
  });
});

describe("ServiceAreaSchema", () => {
  it("parses south,west,north,east", () => {
    expect(ServiceAreaSchema.parse("41,-5.5,51.5,10")).toEqual(PROVISIONAL_SERVICE_AREA);
    expect(ServiceAreaSchema.parse(" 48.1 , 1.4 ,49.3, 3.6 ")).toEqual({
      south: 48.1,
      west: 1.4,
      north: 49.3,
      east: 3.6,
    });
  });

  it.each([
    ["an empty value", ""],
    ["three numbers", "41,-5.5,51.5"],
    ["five numbers", "41,-5.5,51.5,10,1"],
    ["a non-number", "41,west,51.5,10"],
    ["an exponent", "4.1e1,-5.5,51.5,10"],
    ["an empty part", "41,,51.5,10"],
    ["south above north", "51.5,-5.5,41,10"],
    ["an empty rectangle", "41,-5.5,41,10"],
    ["a rectangle across the antimeridian", "41,170,51.5,-170"],
    ["an out-of-range latitude", "-91,-5.5,51.5,10"],
    ["an out-of-range longitude", "41,-181,51.5,10"],
  ])("refuses %s", (_label, value) => {
    expect(ServiceAreaSchema.safeParse(value).success).toBe(false);
  });
});
