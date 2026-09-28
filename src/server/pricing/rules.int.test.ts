import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PROVISIONAL_RULE } from "@/domain/pricing/fixtures";
import { PricingError } from "@/domain/pricing/rule";
import { db } from "@/server/db";

import {
  createPricingRuleVersion,
  getActivePricingRule,
  MAX_VERSION_ATTEMPTS,
  PricingRuleStoreError,
  type PricingRuleTariffInput,
} from "./rules";

// Runs against the real test database (vitest "integration" project), migrations applied.

// Tariff of the test fixture (PROVISIONAL — DEC-03), without the identity held by the columns.
const TARIFF: PricingRuleTariffInput = {
  currency: PROVISIONAL_RULE.currency,
  amountBasis: PROVISIONAL_RULE.amountBasis,
  rounding: PROVISIONAL_RULE.rounding,
  pickupCents: PROVISIONAL_RULE.pickupCents,
  perKmCents: PROVISIONAL_RULE.perKmCents,
  minimumCents: PROVISIONAL_RULE.minimumCents,
};

const ADMIN = { type: "ADMIN", userId: "staff-user-id" } as const;
const SYSTEM = { type: "SYSTEM" } as const;

const T0 = new Date("2026-03-01T00:00:00.000Z");
const T1 = new Date("2026-06-01T00:00:00.000Z");
const T2 = new Date("2026-09-01T00:00:00.000Z");
const ms = (date: Date, delta: number) => new Date(date.getTime() + delta);

function publish(effectiveFrom: Date, tariff: PricingRuleTariffInput = TARIFF) {
  return createPricingRuleVersion({ effectiveFrom, tariff }, ADMIN);
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  return (error as { code?: unknown } | undefined)?.code;
}

describe("pricing rule store (integration)", () => {
  beforeEach(async () => {
    const client = db();
    await client.auditLog.deleteMany();
    await client.booking.deleteMany();
    await client.customer.deleteMany();
    await client.pricingRule.deleteMany();
  });

  afterAll(async () => {
    await db().$disconnect();
  });

  it("raises NO_ACTIVE_PRICING_RULE when no rule exists, never a default", async () => {
    const error: unknown = await getActivePricingRule(T0).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PricingRuleStoreError);
    expect(error).toMatchObject({ code: "NO_ACTIVE_PRICING_RULE" });
  });

  it("creates version 1 with a validated, normalised config and an audit row", async () => {
    const created = await publish(T0, { ...TARIFF, rounding: undefined, timeFloor: undefined });

    expect(created).toMatchObject({
      schemaVersion: 1,
      version: 1,
      currency: "EUR",
      amountBasis: "TTC",
      rounding: "halfUp",
      timeFloor: null,
    });

    const row = await db().pricingRule.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.version).toBe(1);
    expect(row.schemaVersion).toBe(1);
    expect(row.createdBy).toBe(ADMIN.userId);
    expect(row.effectiveFrom.toISOString()).toBe(T0.toISOString());
    // Identity and version live in the columns only.
    expect(row.config).not.toHaveProperty("id");
    expect(row.config).not.toHaveProperty("version");
    expect(row.config).not.toHaveProperty("schemaVersion");
    expect(row.config).toMatchObject({ rounding: "halfUp", timeFloor: null });

    const audit = await db().auditLog.findMany({ where: { entityId: created.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: "ADMIN",
      actorId: ADMIN.userId,
      entityType: "PricingRule",
      action: "pricingRule.create",
      before: null,
      after: { version: 1, effectiveFrom: T0.toISOString(), schemaVersion: 1 },
    });
  });

  it("records the dev seed actor as SYSTEM with no author", async () => {
    const created = await createPricingRuleVersion({ effectiveFrom: T0, tariff: TARIFF }, SYSTEM);
    const row = await db().pricingRule.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.createdBy).toBeNull();
    await expect(
      db().auditLog.findFirstOrThrow({ where: { entityId: created.id } }),
    ).resolves.toMatchObject({ actorType: "SYSTEM", actorId: null });
  });

  it("numbers successive versions and never changes an earlier one", async () => {
    const v1 = await publish(T0);
    const before = await db().pricingRule.findUniqueOrThrow({ where: { id: v1.id } });
    const v2 = await publish(T1, { ...TARIFF, perKmCents: TARIFF.perKmCents + 1 });

    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v2.id).not.toBe(v1.id);
    await expect(db().pricingRule.findUniqueOrThrow({ where: { id: v1.id } })).resolves.toEqual(
      before,
    );
  });

  describe("active rule at an instant", () => {
    it("applies a version from its effectiveFrom inclusive, not one millisecond before", async () => {
      const v1 = await publish(T0);

      await expect(getActivePricingRule(T0)).resolves.toEqual(v1);
      const error: unknown = await getActivePricingRule(ms(T0, -1)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({ code: "NO_ACTIVE_PRICING_RULE" });
    });

    it("ignores a version scheduled in the future", async () => {
      const v1 = await publish(T0);
      const v2 = await publish(T2);

      await expect(getActivePricingRule(T1)).resolves.toEqual(v1);
      await expect(getActivePricingRule(ms(T2, -1))).resolves.toEqual(v1);
      await expect(getActivePricingRule(T2)).resolves.toEqual(v2);
    });

    it("picks the highest version among several already effective", async () => {
      await publish(T0);
      await publish(T1);
      const v3 = await publish(T1);

      await expect(getActivePricingRule(T2)).resolves.toEqual(v3);
    });

    it("lets a later version supersede an earlier one, even one scheduled after it", async () => {
      const v1 = await publish(T0);
      await publish(T2);
      const v3 = await publish(T1);

      await expect(getActivePricingRule(ms(T1, -1))).resolves.toEqual(v1);
      await expect(getActivePricingRule(T1)).resolves.toEqual(v3);
      await expect(getActivePricingRule(ms(T2, 1))).resolves.toEqual(v3);
    });

    it("rejects an invalid instant", async () => {
      await expect(getActivePricingRule(new Date(Number.NaN))).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("invalid stored config: INVALID_PRICING_RULE, no price", () => {
    async function corrupt(config: unknown, schemaVersion = 1) {
      const rule = await publish(T0);
      await db().$executeRaw`
        UPDATE "PricingRule"
        SET "config" = ${JSON.stringify(config)}::jsonb, "schemaVersion" = ${schemaVersion}
        WHERE "id" = ${rule.id}`;
    }

    it.each([
      ["a zero minimum", { ...TARIFF, minimumCents: 0 }],
      ["a missing field", { ...TARIFF, perKmCents: undefined }],
      ["a float amount", { ...TARIFF, pickupCents: 15.5 }],
      ["an unknown field", { ...TARIFF, surprise: 1 }],
      ["an array", [TARIFF]],
      ["a scalar", 42],
      ["an embedded id", { ...TARIFF, id: "other-rule" }],
      ["an embedded version", { ...TARIFF, version: 99 }],
    ])("rejects %s", async (_label, config) => {
      await corrupt(config);
      const error: unknown = await getActivePricingRule(T1).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PricingError);
      expect(error).toMatchObject({ code: "INVALID_PRICING_RULE" });
    });

    it("rejects an unknown schema version", async () => {
      await corrupt(TARIFF, 2);
      await expect(codeOf(getActivePricingRule(T1))).resolves.toBe("INVALID_PRICING_RULE");
    });
  });

  it("rejects an invalid tariff on write and stores nothing", async () => {
    await expect(codeOf(publish(T0, { ...TARIFF, minimumCents: 0 }))).resolves.toBe(
      "INVALID_PRICING_RULE",
    );
    await expect(
      codeOf(publish(T0, { ...TARIFF, id: "forged" } as PricingRuleTariffInput)),
    ).resolves.toBe("INVALID_PRICING_RULE");
    await expect(
      createPricingRuleVersion({ effectiveFrom: new Date(Number.NaN), tariff: TARIFF }, ADMIN),
    ).rejects.toBeInstanceOf(TypeError);

    await expect(db().pricingRule.count()).resolves.toBe(0);
    await expect(db().auditLog.count()).resolves.toBe(0);
  });

  it("never allocates the same version twice under concurrent publications", async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_VERSION_ATTEMPTS }, () => publish(T0)),
    );

    const versions = results.map((rule) => rule.version).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: MAX_VERSION_ATTEMPTS }, (_, i) => i + 1));
    await expect(db().pricingRule.count()).resolves.toBe(MAX_VERSION_ATTEMPTS);
    await expect(db().auditLog.count()).resolves.toBe(MAX_VERSION_ATTEMPTS);
  });

  it("leaves a booking on its own rule version when a new version is published (BR-13)", async () => {
    const v1 = await publish(T0);
    const customer = await db().customer.create({
      data: { name: "Guest Test", email: "guest@avelys.test" },
    });
    const booking = await db().booking.create({
      data: {
        reference: "VTC-TESTRULE",
        customerId: customer.id,
        pickupLabel: "A",
        pickupLat: 48.85,
        pickupLng: 2.35,
        dropoffLabel: "B",
        dropoffLat: 49.0,
        dropoffLng: 2.55,
        pickupAt: T1,
        pickupLocalDateTime: T1,
        passengerCount: 1,
        luggageCount: 0,
        quotedDistanceMeters: 10_000,
        quotedDurationSeconds: 1_200,
        // Test values only, not a tariff.
        totalTtcCents: 3_000,
        currency: "EUR",
        pricingSnapshot: { schemaVersion: 1, note: "test snapshot" },
        pricingRuleId: v1.id,
        pricingRuleVersion: v1.version,
      },
    });

    const v2 = await publish(T0, { ...TARIFF, minimumCents: TARIFF.minimumCents + 100 });
    await expect(getActivePricingRule(T1)).resolves.toEqual(v2);

    const stored = await db().booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored).toMatchObject({
      pricingRuleId: v1.id,
      pricingRuleVersion: 1,
      totalTtcCents: 3_000,
      pricingSnapshot: { schemaVersion: 1, note: "test snapshot" },
    });
  });
});
