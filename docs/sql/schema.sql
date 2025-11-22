CREATE TABLE "Store" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    openingTime TEXT,
    closingTime TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Terminal" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "deviceId" TEXT NOT NULL UNIQUE,
    label TEXT,
    "storeId" TEXT NOT NULL REFERENCES "Store"(id) ON DELETE CASCADE,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'DRIVER', 'CAST');
CREATE TYPE "AttendanceType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');
CREATE TYPE "SaleCategory" AS ENUM ('SET', 'DRINK', 'BOTTLE', 'OTHER');

CREATE TABLE "User" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    "passwordHash" TEXT,
    role "Role" NOT NULL,
    "displayName" TEXT NOT NULL,
    "storeId" TEXT REFERENCES "Store"(id) ON DELETE SET NULL,
    "castPinHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Attendance" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "storeId" TEXT NOT NULL REFERENCES "Store"(id) ON DELETE CASCADE,
    type "AttendanceType" NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "AttendanceApproval" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "storeId" TEXT NOT NULL REFERENCES "Store"(id) ON DELETE CASCADE,
    date TIMESTAMPTZ NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT FALSE,
    "approvedAt" TIMESTAMPTZ,
    "approvedById" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    UNIQUE ("storeId", date)
);

CREATE TABLE "Sale" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "storeId" TEXT NOT NULL REFERENCES "Store"(id) ON DELETE CASCADE,
    "tableNumber" TEXT NOT NULL,
    category "SaleCategory" NOT NULL,
    amount INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Ride" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "driverId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "storeId" TEXT REFERENCES "Store"(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "Attendance_userId_idx" ON "Attendance"("userId");
CREATE INDEX "Attendance_storeId_idx" ON "Attendance"("storeId");
CREATE INDEX "AttendanceApproval_storeId_date_idx" ON "AttendanceApproval"("storeId", date);
CREATE INDEX "Sale_storeId_createdAt_idx" ON "Sale"("storeId", "createdAt");
CREATE INDEX "Sale_userId_idx" ON "Sale"("userId");
CREATE INDEX "Ride_driverId_idx" ON "Ride"("driverId");
CREATE INDEX "Terminal_storeId_idx" ON "Terminal"("storeId");
