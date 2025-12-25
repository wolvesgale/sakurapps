-- CreateTable
CREATE TABLE "AttendancePhoto" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendancePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePhoto_attendanceId_key" ON "AttendancePhoto"("attendanceId");

-- AddForeignKey
ALTER TABLE "AttendancePhoto" ADD CONSTRAINT "AttendancePhoto_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePhoto" ADD CONSTRAINT "AttendancePhoto_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePhoto" ADD CONSTRAINT "AttendancePhoto_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
