-- VTC-026: Customer, Booking and AuditLog (Master Spec §20.1). Additive only: four new enums,
-- three new tables, no change to existing objects. Rollback: revert the PR; the tables stay
-- unused until a service writes them (drop by hand in local dev only).

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'REFUSED', 'CANCELLED', 'CONFIRMED', 'DRIVER_ASSIGNED', 'IN_PROGRESS', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'DISPATCHER', 'DRIVER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('fr', 'en');

-- CreateEnum
CREATE TYPE "TransportKind" AS ENUM ('FLIGHT', 'TRAIN');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "preferredLocale" "Locale" NOT NULL DEFAULT 'fr',
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(32) NOT NULL,
    "customerId" TEXT NOT NULL,
    "pickupLabel" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupPlaceId" TEXT,
    "dropoffLabel" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "dropoffPlaceId" TEXT,
    "pickupAt" TIMESTAMPTZ(3) NOT NULL,
    "pickupLocalDateTime" TIMESTAMP(0) NOT NULL,
    "pickupTimeZone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
    "passengerCount" INTEGER NOT NULL,
    "luggageCount" INTEGER NOT NULL,
    "quotedDistanceMeters" INTEGER NOT NULL,
    "quotedDurationSeconds" INTEGER NOT NULL,
    "totalTtcCents" INTEGER NOT NULL,
    "totalHtCents" INTEGER,
    "vatCents" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingRuleId" TEXT NOT NULL,
    "pricingRuleVersion" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "transportKind" "TransportKind",
    "transportNumber" TEXT,
    "transportOrigin" TEXT,
    "transportTerminal" TEXT,
    "transportScheduledAt" TIMESTAMPTZ(3),
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlationId" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_pickupAt_idx" ON "Booking"("pickupAt");

-- CreateIndex
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
