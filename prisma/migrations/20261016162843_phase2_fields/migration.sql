-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "autoRuleId" TEXT,
ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "notes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "requested" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'form',
ADD COLUMN     "suggestedTierId" TEXT;

-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN     "country" TEXT,
ADD COLUMN     "pausedTierId" TEXT,
ADD COLUMN     "taxExemptions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "decidedOnExpiry" TEXT,
ADD COLUMN     "rejectReason" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "country" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "placeholderCompanyGid" TEXT,
ADD COLUMN     "subscriptionGid" TEXT;

-- AlterTable
ALTER TABLE "Tier" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'market',
ADD COLUMN     "placeholderLocationGid" TEXT;
