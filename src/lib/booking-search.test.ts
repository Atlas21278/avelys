import { describe, expect, it } from "vitest";

import {
  BOOKING_SEARCH_FIELDS,
  bookingSearchHref,
  bookingSearchQuery,
  parseBookingSearch,
  readBookingSearch,
} from "./booking-search";

describe("parseBookingSearch", () => {
  it("accepts an entirely empty search", () => {
    const result = parseBookingSearch({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it("drops empty and blank fields", () => {
    const result = parseBookingSearch({
      pickup: "",
      dropoff: "   ",
      date: "",
      time: "",
      passengers: "",
      luggage: " ",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it("trims text and normalises counts to integers", () => {
    const result = parseBookingSearch({
      pickup: "  Aéroport Charles-de-Gaulle ",
      dropoff: "Hôtel, Paris 8e",
      date: "2026-10-12",
      time: "07:45",
      passengers: " 3 ",
      luggage: "0",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      pickup: "Aéroport Charles-de-Gaulle",
      dropoff: "Hôtel, Paris 8e",
      date: "2026-10-12",
      time: "07:45",
      passengers: 3,
      luggage: 0,
    });
  });

  it("accepts numbers as well as strings for counts", () => {
    expect(parseBookingSearch({ passengers: 2, luggage: 1 }).data).toEqual({
      passengers: 2,
      luggage: 1,
    });
  });

  it.each([
    ["negative passengers", { passengers: "-1" }],
    ["zero passengers", { passengers: "0" }],
    ["negative luggage", { luggage: "-2" }],
    ["decimal passengers", { passengers: "1.5" }],
    ["non-numeric passengers", { passengers: "two" }],
    ["non-numeric luggage", { luggage: "1e2" }],
    ["decimal number", { luggage: 1.5 }],
    ["unsafe integer", { passengers: "9007199254740993" }],
  ])("rejects %s", (_case, input) => {
    expect(parseBookingSearch(input).success).toBe(false);
  });

  it("sets no maximum passenger or luggage count (DEC-02 open)", () => {
    expect(parseBookingSearch({ passengers: "57", luggage: "120" }).data).toEqual({
      passengers: 57,
      luggage: 120,
    });
  });

  it.each([
    ["an impossible date", { date: "2026-02-30" }],
    ["a malformed date", { date: "12/10/2026" }],
    ["an out-of-range hour", { time: "24:00" }],
    ["a malformed time", { time: "7h45" }],
    ["an over-long place", { pickup: "x".repeat(201) }],
    ["a non-string place", { dropoff: 42 }],
  ])("rejects %s", (_case, input) => {
    expect(parseBookingSearch(input).success).toBe(false);
  });

  it("never carries an amount, whatever the input contains", () => {
    const result = parseBookingSearch({
      pickup: "Orly",
      price: "10",
      amount: "1000",
      amountCents: 1000,
      total: "5",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ pickup: "Orly" });
    expect(BOOKING_SEARCH_FIELDS).toEqual([
      "pickup",
      "dropoff",
      "date",
      "time",
      "passengers",
      "luggage",
    ]);
  });
});

describe("bookingSearchQuery", () => {
  it("is empty for an empty search", () => {
    expect(bookingSearchQuery({})).toBe("");
  });

  it("lists fields in a stable order", () => {
    expect(
      bookingSearchQuery({
        luggage: 2,
        passengers: 1,
        time: "18:05",
        date: "2026-12-24",
        dropoff: "Versailles",
        pickup: "Paris",
      }),
    ).toBe("pickup=Paris&dropoff=Versailles&date=2026-12-24&time=18%3A05&passengers=1&luggage=2");
  });

  it("encodes special characters", () => {
    const query = bookingSearchQuery({ pickup: "Gare de Lyon & Hall 1", dropoff: "Café #3 = ?" });
    expect(query).toBe("pickup=Gare+de+Lyon+%26+Hall+1&dropoff=Caf%C3%A9+%233+%3D+%3F");
    const params = new URLSearchParams(query);
    expect(params.get("pickup")).toBe("Gare de Lyon & Hall 1");
    expect(params.get("dropoff")).toBe("Café #3 = ?");
  });

  it("keeps a zero luggage count", () => {
    expect(bookingSearchQuery({ luggage: 0 })).toBe("luggage=0");
  });
});

describe("bookingSearchHref", () => {
  const search = { pickup: "CDG", dropoff: "Paris 8e", passengers: 2 };

  it("points to the French booking page", () => {
    expect(bookingSearchHref(search, "fr")).toBe(
      "/reservation?pickup=CDG&dropoff=Paris+8e&passengers=2",
    );
  });

  it("points to the English booking page from the routing table", () => {
    expect(bookingSearchHref(search, "en")).toBe(
      "/en/booking?pickup=CDG&dropoff=Paris+8e&passengers=2",
    );
  });

  it("has no query string for an empty search", () => {
    expect(bookingSearchHref({}, "fr")).toBe("/reservation");
    expect(bookingSearchHref({}, "en")).toBe("/en/booking");
  });
});

describe("readBookingSearch", () => {
  it("returns an empty search when no parameter is given", () => {
    expect(readBookingSearch({})).toEqual({});
    expect(readBookingSearch(new URLSearchParams())).toEqual({});
  });

  it("keeps the valid fields and ignores the invalid ones", () => {
    expect(
      readBookingSearch({
        pickup: "Orly",
        dropoff: "x".repeat(201),
        date: "2026-02-30",
        time: "07:45",
        passengers: "zero",
        luggage: "2",
      }),
    ).toEqual({ pickup: "Orly", time: "07:45", luggage: 2 });
  });

  it("ignores every field when all of them are invalid, without throwing", () => {
    expect(
      readBookingSearch({ date: "tomorrow", time: "25:00", passengers: "-1", luggage: "1.5" }),
    ).toEqual({});
  });

  it("takes the first value of a repeated parameter", () => {
    expect(
      readBookingSearch({ pickup: ["Gare du Nord", "Orly"], passengers: ["2", "3"], luggage: [] }),
    ).toEqual({ pickup: "Gare du Nord", passengers: 2 });
  });

  it("reads a URL query string, decoding encoded characters", () => {
    const query = "pickup=Gare+de+Lyon+%26+Hall+1&dropoff=Caf%C3%A9+%233&time=18%3A05&luggage=0";
    expect(readBookingSearch(new URLSearchParams(query))).toEqual({
      pickup: "Gare de Lyon & Hall 1",
      dropoff: "Café #3",
      time: "18:05",
      luggage: 0,
    });
  });

  it("round-trips what bookingSearchQuery writes", () => {
    const search = {
      pickup: "Aéroport Charles-de-Gaulle",
      dropoff: "Hôtel, Paris 8e",
      date: "2026-10-12",
      time: "07:45",
      passengers: 3,
      luggage: 0,
    };
    expect(readBookingSearch(new URLSearchParams(bookingSearchQuery(search)))).toEqual(search);
  });

  it("drops unknown parameters such as an amount", () => {
    expect(
      readBookingSearch({ pickup: "Orly", price: "10", amountCents: "1000", total: undefined }),
    ).toEqual({ pickup: "Orly" });
  });
});
