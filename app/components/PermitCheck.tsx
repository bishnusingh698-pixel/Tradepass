import { useEffect } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "./useLocaleHref";
import { EXPIRY_HINTS, IRS_TEOS_URL, MTC_CERTIFICATE_URL, PERMIT_LOOKUPS, stateHints, type UsCertForm } from "../lib/us-states";

// "Check on the state's website" for a US seller's permit (A2): the official lookup page (web forms
// get a link only, no scraping), what to type there, a "Checked by staff" mark (who, when) and, where
// the state publishes a free open dataset (Texas), the automatic check with "Check again".

export type PermitCheckData = {
  id: string;
  region: string | null;
  form: string | null;
  checkResult: string | null;
  checkName: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
};

export function PermitCheck({ cert, liveAllowed }: { cert: PermitCheckData; liveAllowed: boolean }) {
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher<{ ok: boolean; intent: string; error?: string; result?: string }>();
  const revalidator = useRevalidator();
  const region = (cert.region ?? "").toUpperCase() as keyof typeof PERMIT_LOOKUPS;
  const lookup = PERMIT_LOOKUPS[region];
  const hints = stateHints(region, (cert.form as UsCertForm) ?? null);

  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    shopify.toast.show(t(d.ok ? `permit.toast.${d.intent}` : `permit.error.${d.error ?? "generic"}`), { isError: !d.ok });
    if (d.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const when = cert.checkedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(cert.checkedAt)) : "";
  const post = (intent: "mark" | "live") => fetcher.submit({ intent, id: cert.id }, { method: "POST", action: href("/app/certificates/check") });

  return (
    <s-stack direction="block" gap="small-200">
      {cert.checkResult && (
        <s-text color={cert.checkResult === "not_found" ? undefined : "subdued"} tone={cert.checkResult === "not_found" ? "critical" : undefined}>
          {cert.checkResult === "manual"
            ? t("permit.checkedBy", { name: cert.checkedBy ?? "", date: when })
            : t(`permit.live.${cert.checkResult}`, { name: cert.checkName ?? "", date: when })}
        </s-text>
      )}
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {lookup ? (
          <>
            <s-button href={lookup.url} target="_blank" variant="secondary">{t("permit.open", { state: region })}</s-button>
            <s-text color="subdued">{t(`permit.enter.${lookup.enter}`)}</s-text>
          </>
        ) : cert.form === "exempt" ? (
          <s-button href={IRS_TEOS_URL} target="_blank" variant="secondary">{t("permit.irs")}</s-button>
        ) : (
          <s-text color="subdued">{t("permit.noLookup")}</s-text>
        )}
        <s-button variant="tertiary" disabled={fetcher.state !== "idle"} onClick={() => post("mark")}>{t("permit.mark")}</s-button>
        {lookup?.live && liveAllowed && (
          <s-button variant="tertiary" disabled={fetcher.state !== "idle"} onClick={() => post("live")}>{t("permit.recheck")}</s-button>
        )}
      </s-stack>
      {hints.map((h) => (
        <s-text key={h} color="subdued">
          {t(`permit.hint.${h}`, { state: region })}
          {h === "mtc_conditional" && <> <s-link href={MTC_CERTIFICATE_URL} target="_blank">{t("permit.hint.mtcLink")}</s-link></>}
        </s-text>
      ))}
      {EXPIRY_HINTS[region] === "dec31" && <s-text color="subdued">{t("permit.hint.flExpiry")}</s-text>}
    </s-stack>
  );
}
