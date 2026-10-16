import { useI18n } from "../lib/i18n/react";

/** Buyer certificate summary badge (Valid / Expiring / Expired / Pending / None). */
export function CertBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = status === "valid" ? "success" : status === "expiring" ? "warning" : status === "expired" ? "critical" : "neutral";
  return <s-badge tone={tone}>{t(`buyers.cert.${status}`)}</s-badge>;
}
