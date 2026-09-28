-- VTC-030: Stripe webhook idempotence (Master Spec §11, ADR-0006, BR-42). Additive only: one new
-- enum and one new table, nothing existing is modified. The table keeps the event identity only
-- (provider, event id, type, reception time), never a Stripe object or payload.
-- Rollback: revert the PR; the table stays unused (drop it by hand in local dev only).

-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('STRIPE');

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL,
    "eventId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(255) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_provider_eventId_key" ON "ProcessedWebhookEvent"("provider", "eventId");
