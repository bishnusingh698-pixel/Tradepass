-- Tradepass no longer sends email itself (DECISIONS D-091). Shopify's own B2B
-- welcome email is the only email left, and Shopify sends it.

-- Outgoing email queue, quota counter and log.
DROP TABLE "EmailLog";

-- Renewal-reminder bookkeeping (the 30/7-day reminder emails are gone).
ALTER TABLE "Certificate" DROP COLUMN "remindedAt";

-- Store addresses that were only used as alert recipient and reply-to.
ALTER TABLE "Shop" DROP COLUMN "email",
DROP COLUMN "contactEmail";

-- The rejection reason used to travel only inside the rejection email; it is
-- now kept so the merchant can copy the rejection message at any time.
ALTER TABLE "Application" ADD COLUMN "rejectReason" TEXT;
