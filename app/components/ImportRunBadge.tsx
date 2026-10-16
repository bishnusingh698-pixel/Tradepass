import { useI18n } from "../lib/i18n/react";

/** Import run state badge (Import list and run page). */
export function ImportRunBadge({ state }: { state: string }) {
  const { t } = useI18n();
  const tone = state === "done" ? "success" : state === "failed" ? "critical" : state === "running" ? "info" : "neutral";
  const known = ["draft", "validated", "running", "done", "failed"].includes(state) ? state : "draft";
  return <s-badge tone={tone}>{t(`import.state.${known}`)}</s-badge>;
}
