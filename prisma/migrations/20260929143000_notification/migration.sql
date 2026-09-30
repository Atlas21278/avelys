-- VTC-043: Notification model (Master Spec §15, ADR-0011, BR-50, BR-60). Additive only: two new
-- enums and one new table; no existing row or column is touched. No email address and no email
-- content is stored. Rollback: revert the PR; the empty table stays in place (drop it by hand in
-- local dev only, never elsewhere).
-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('PAYMENT_ACTION_REQUIRED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "locale" "Locale" NOT NULL,
    "dedupeKey" VARCHAR(255) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(64),
    "providerMessageId" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

