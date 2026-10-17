import { useI18n } from "../lib/i18n/react";

// Small display helpers shared by the applications queue and detail pages.

const STATUS_TONE: Record<string, "info" | "success" | "warning" | "critical" | "neutral"> = {
  pending: "info",
  needs_info: "warning",
  approved: "success",
  rejected: "neutral",
  withdrawn: "neutral",
  draft: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <s-badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`applications.status.${status}`)}</s-badge>;
}

const TAX_TONE: Record<string, "success" | "warning" | "neutral" | "critical"> = {
  verified: "success",
  not_verified: "warning",
  unavailable: "neutral",
  na: "neutral",
  skipped: "neutral",
};

export function TaxCheckBadge({ value }: { value: string }) {
  const { t } = useI18n();
  return <s-badge tone={TAX_TONE[value] ?? "neutral"}>{t(`applications.taxCheck.${value}`)}</s-badge>;
}

/** Flag emoji are avoided (not all platforms render them); the localized country name is shown instead. */
export function CountryName({ code }: { code: string }) {
  const { locale } = useI18n();
  let name = code;
  try {
    name = new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    // unknown code: show as is
  }
  return <s-text>{name}</s-text>;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60],
];

export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const secs = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return rtf.format(0, "minute");
}

export function RelativeTime({ iso }: { iso: string }) {
  const { locale } = useI18n();
  const full = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <time dateTime={iso} title={full}>
      {relativeTime(iso, locale)}
    </time>
  );
}
