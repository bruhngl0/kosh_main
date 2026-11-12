-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'INTEGRATION';

-- AlterTable
ALTER TABLE "subscribers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "delivery_note" TEXT,
ADD COLUMN     "delivery_slot" TEXT,
ADD COLUMN     "diet" TEXT,
ADD COLUMN     "dislikes" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "medical" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "onboarding_ref" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "profile" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "start_date" DATE,
ADD COLUMN     "synced_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_external_ref_key" ON "subscribers"("external_ref");


-- BR-24: the statuses the app understands. Every existing row is 'active'
-- (the only value the app has ever written), so this cannot fail on deploy.
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_status_known"
  CHECK ("status" IN ('onboarding', 'active', 'paused', 'ended'));
