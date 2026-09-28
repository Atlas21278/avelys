-- VTC-025: versioned PricingRule (Master Spec §8, ADR-0009). Additive only: one new table, its
-- indexes, and a foreign key on the existing Booking columns (pricingRuleId, pricingRuleVersion).
-- The foreign key is added NOT VALID (existing Booking rows are not scanned, short lock) and
-- validated by the next migration (20260928160700_validate_booking_pricing_rule_fk), see
-- docs/architecture/database.md. Rollback: revert the PR; the table stays unused (drop the
-- constraint and the table by hand in local dev only).

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "config" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_version_key" ON "PricingRule"("version");

-- CreateIndex
CREATE INDEX "PricingRule_effectiveFrom_idx" ON "PricingRule"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_id_version_key" ON "PricingRule"("id", "version");

-- AddForeignKey (NOT VALID: validated by the next migration)
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_pricingRuleId_pricingRuleVersion_fkey" FOREIGN KEY ("pricingRuleId", "pricingRuleVersion") REFERENCES "PricingRule"("id", "version") ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
