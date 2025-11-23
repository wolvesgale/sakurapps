-- Add approval tracking fields to Attendance
ALTER TABLE "Attendance" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Attendance" ADD COLUMN "approvedById" TEXT;

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
