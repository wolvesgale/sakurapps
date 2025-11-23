-- Add PaymentMethod enum and attendance companion flag, adjust sales schema for payment handling

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PAYPAY', 'CARD');

-- AddColumn
ALTER TABLE "Attendance" ADD COLUMN     "isCompanion" BOOLEAN NOT NULL DEFAULT false;

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT IF EXISTS "Sale_userId_fkey";

-- DropColumn
ALTER TABLE "Sale" DROP COLUMN IF EXISTS "tableNumber";
ALTER TABLE "Sale" DROP COLUMN IF EXISTS "category";
ALTER TABLE "Sale" DROP COLUMN IF EXISTS "userId";

-- AddColumn
ALTER TABLE "Sale" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE "Sale" ADD COLUMN     "staffId" TEXT;

-- SetNotNull
ALTER TABLE "Sale" ALTER COLUMN "staffId" SET NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS "Sale_staffId_idx" ON "Sale"("staffId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropEnum
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SaleCategory') THEN
    DROP TYPE "SaleCategory";
  END IF;
END $$;
