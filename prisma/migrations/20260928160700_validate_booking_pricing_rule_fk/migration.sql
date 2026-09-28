-- VTC-025: validates the foreign key added NOT VALID by 20260928160636_pricing_rule. VALIDATE
-- only takes a SHARE UPDATE EXCLUSIVE lock on "Booking": reads and writes continue during the
-- scan. It fails if a Booking references a missing (pricingRuleId, pricingRuleVersion) pair; no
-- service writes bookings yet, so no deployed environment holds such a row. Rollback: revert the
-- PR; the validated constraint is harmless (drop it by hand in local dev only).

ALTER TABLE "Booking" VALIDATE CONSTRAINT "Booking_pricingRuleId_pricingRuleVersion_fkey";
