-- VTC-031: Payment model (Master Spec §11, §20.1, ADR-0006, BR-40, BR-41). Additive only: one new
-- enum, one new table and one nullable Booking column (existing rows stay NULL, so the new
-- foreign key validates at once). Stripe object ids only, never a card number or card detail.
-- Rollback: revert the PR; the column and the table stay unused (drop them by hand in local dev
-- only).
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "currentPaymentId" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "stripeCustomerId" VARCHAR(255) NOT NULL,
    "stripeSetupIntentId" VARCHAR(255) NOT NULL,
    "stripePaymentMethodId" VARCHAR(255) NOT NULL,
    "stripePaymentIntentId" VARCHAR(255),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeSetupIntentId_key" ON "Payment"("stripeSetupIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_currentPaymentId_key" ON "Booking"("currentPaymentId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_currentPaymentId_fkey" FOREIGN KEY ("currentPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
