import { describe, expect, it } from "vitest";

import { isEmailSender } from "./address";

describe("isEmailSender", () => {
  it("accepts a bare address or a display name with the address", () => {
    expect(isEmailSender("bookings@example.com")).toBe(true);
    expect(isEmailSender("Avelys <bookings@example.com>")).toBe(true);
    expect(isEmailSender("Avelys Paris<bookings@example.com>")).toBe(true);
  });

  it("refuses anything else", () => {
    for (const value of [
      "",
      " bookings@example.com",
      "bookings@example.com ",
      "bookings",
      "Avelys",
      "Avelys <bookings>",
      "<bookings@example.com>",
      "Avelys <bookings@example.com",
      "A <b> <bookings@example.com>",
    ]) {
      expect(isEmailSender(value), value).toBe(false);
    }
  });
});
