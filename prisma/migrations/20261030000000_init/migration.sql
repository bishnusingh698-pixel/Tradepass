-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "shop" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "planName" TEXT,
    "isPlus" BOOLEAN NOT NULL DEFAULT false,
    "isDevStore" BOOLEAN NOT NULL DEFAULT false,
    "b2bEnabled" BOOLEAN NOT NULL DEFAULT false,
    "b2bMarketsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "catalogLimit" INTEGER,
    "directCatalogs" BOOLEAN NOT NULL DEFAULT false,
    "billingPlan" TEXT NOT NULL DEFAULT 'free',
    "primaryLocale" TEXT NOT NULL DEFAULT 'en',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "settingsVersion" INTEGER NOT NULL DEFAULT 1,
    "welcomeDoneAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "name" TEXT,
    "email" TEXT,
    "contactEmail" TEXT,
    "domainUrl" TEXT,
    "currency" TEXT,
    "country" TEXT,
    "placeholderCompanyGid" TEXT,
    "subscriptionGid" TEXT,
    "trialStartedAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "suggestedTierId" TEXT,
    "definition" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "formId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "countryCode" TEXT,
    "businessType" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "customerGid" TEXT,
    "answers" JSONB NOT NULL,
    "taxNumberEnc" TEXT,
    "taxCheck" TEXT NOT NULL DEFAULT 'na',
    "taxCheckName" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignee" TEXT,
    "approvalState" JSONB,
    "approvalStatus" TEXT,
    "buyerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'form',
    "suggestedTierId" TEXT,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "requested" JSONB,
    "autoRuleId" TEXT,
    "ipHash" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationFile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fileGid" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buyerNames" JSONB NOT NULL DEFAULT '{}',
    "marketGid" TEXT,
    "catalogGid" TEXT,
    "priceListGid" TEXT,
    "publicationGid" TEXT,
    "createdByUs" BOOLEAN NOT NULL DEFAULT true,
    "discountPct" INTEGER,
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "syncState" TEXT NOT NULL DEFAULT 'ok',
    "mode" TEXT NOT NULL DEFAULT 'market',
    "placeholderLocationGid" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyGid" TEXT NOT NULL,
    "locationGids" TEXT[],
    "contactGid" TEXT,
    "tierId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "pausedTierId" TEXT,
    "taxExemptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "country" TEXT,
    "source" TEXT NOT NULL DEFAULT 'application',
    "name" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "buyerId" TEXT,
    "applicationId" TEXT,
    "type" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "numberEnc" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileGid" TEXT,
    "remindedAt" JSONB NOT NULL DEFAULT '{}',
    "rejectReason" TEXT,
    "decidedOnExpiry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "toHash" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "quotaDay" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "result" TEXT NOT NULL DEFAULT 'ok',
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopLock" (
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopLock_pkey" PRIMARY KEY ("shop","name")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "mapping" JSONB,
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenUse" (
    "tokenHash" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "TokenUse_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateHit" (
    "key" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RateHit_pkey" PRIMARY KEY ("key","window")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Form_shop_idx" ON "Form"("shop");

-- CreateIndex
CREATE INDEX "Application_shop_status_submittedAt_idx" ON "Application"("shop", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "Application_shop_email_idx" ON "Application"("shop", "email");

-- CreateIndex
CREATE INDEX "Application_approvalStatus_idx" ON "Application"("approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Application_shop_idempotencyKey_key" ON "Application"("shop", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApplicationFile_shop_applicationId_idx" ON "ApplicationFile"("shop", "applicationId");

-- CreateIndex
CREATE INDEX "Tier_shop_idx" ON "Tier"("shop");

-- CreateIndex
CREATE INDEX "Buyer_shop_tierId_idx" ON "Buyer"("shop", "tierId");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_shop_companyGid_key" ON "Buyer"("shop", "companyGid");

-- CreateIndex
CREATE INDEX "Certificate_shop_expiresOn_idx" ON "Certificate"("shop", "expiresOn");

-- CreateIndex
CREATE INDEX "Certificate_shop_buyerId_idx" ON "Certificate"("shop", "buyerId");

-- CreateIndex
CREATE INDEX "Certificate_shop_applicationId_idx" ON "Certificate"("shop", "applicationId");

-- CreateIndex
CREATE INDEX "EmailLog_quotaDay_status_idx" ON "EmailLog"("quotaDay", "status");

-- CreateIndex
CREATE INDEX "EmailLog_shop_quotaDay_idx" ON "EmailLog"("shop", "quotaDay");

-- CreateIndex
CREATE INDEX "EmailLog_shop_toHash_idx" ON "EmailLog"("shop", "toHash");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_createdAt_idx" ON "ActivityLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_subject_idx" ON "ActivityLog"("shop", "subject");

-- CreateIndex
CREATE INDEX "Job_state_runAfter_idx" ON "Job"("state", "runAfter");

-- CreateIndex
CREATE INDEX "Job_shop_type_state_idx" ON "Job"("shop", "type", "state");

-- CreateIndex
CREATE INDEX "ImportRun_shop_idx" ON "ImportRun"("shop");

-- CreateIndex
CREATE INDEX "TokenUse_expiresAt_idx" ON "TokenUse"("expiresAt");

-- CreateIndex
CREATE INDEX "TokenUse_shop_subjectId_idx" ON "TokenUse"("shop", "subjectId");

-- CreateIndex
CREATE INDEX "Rule_shop_idx" ON "Rule"("shop");

