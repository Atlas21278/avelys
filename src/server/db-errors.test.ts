import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { databaseUnavailableReason } from "./db-errors";

const CLIENT_VERSION = "test";

function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError("test error", {
    code,
    clientVersion: CLIENT_VERSION,
  });
}

describe("databaseUnavailableReason", () => {
  it.each(["P1000", "P1001", "P1002", "P1008", "P1017", "P2024"])(
    "treats %s as the database being unavailable",
    (code) => {
      expect(databaseUnavailableReason(known(code))).toBe(code);
    },
  );

  it("treats a client initialization failure as the database being unavailable", () => {
    expect(
      databaseUnavailableReason(new Prisma.PrismaClientInitializationError("test", CLIENT_VERSION)),
    ).toBe("client_init");
  });

  it.each([
    ["a unique violation", known("P2002")],
    ["a foreign key violation", known("P2003")],
    ["a plain error", new Error("connect ECONNREFUSED")],
    ["a non-error value", "P1001"],
    ["undefined", undefined],
  ])("does not treat %s as the database being unavailable", (_label, error) => {
    expect(databaseUnavailableReason(error)).toBeNull();
  });
});
