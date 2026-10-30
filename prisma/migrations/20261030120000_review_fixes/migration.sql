-- Review fixes: when an email was claimed for sending (stuck "sending" rows are requeued by this).
ALTER TABLE "EmailLog" ADD COLUMN "claimedAt" TIMESTAMP(3);
