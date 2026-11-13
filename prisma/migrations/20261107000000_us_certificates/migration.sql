-- US resale/exemption certificates per state (form, permit check) and applicant attribution.
ALTER TABLE "Certificate" ADD COLUMN "form" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "checkResult" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "checkName" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "checkedBy" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "checkedAt" TIMESTAMP(3);
ALTER TABLE "Application" ADD COLUMN "attribution" JSONB;
