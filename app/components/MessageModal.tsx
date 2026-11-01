import { useAppBridge } from "@shopify/app-bridge-react";
import { useI18n } from "../lib/i18n/react";
import type { ApplicantMessage } from "../lib/messages";
import { Modal } from "./form-builder/wc";

// Tradepass doesn't send email (D-091). After "Ask for more information",
// "Reject" or "Copy renewal link" the merchant gets the ready-made message in
// the recipient's language, copies it, or opens it in their own email app.

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (permissions policy in the admin iframe, older browser): classic fallback.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function MessageModal(p: {
  id: string;
  message: ApplicantMessage | null;
  company: string;
  /** The message carries a single-use secure link (more info, renewal). */
  withLink?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const shopify = useAppBridge();
  const m = p.message;
  const language = (() => {
    if (!m) return "";
    try {
      return new Intl.DisplayNames([m.locale], { type: "language" }).of(m.locale) ?? m.locale;
    } catch {
      return m.locale;
    }
  })();
  const copy = async () => {
    if (!m) return;
    const ok = await copyText(m.body);
    shopify.toast.show(t(ok ? "message.modal.copied" : "message.modal.copyFailed"), { isError: !ok });
  };
  return (
    <Modal id={p.id} heading={t("message.modal.heading", { company: p.company })} open={Boolean(m)} onClose={p.onClose}>
      {m && (
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("message.modal.intro", { language })}</s-paragraph>
          {p.withLink && <s-paragraph color="subdued">{t("message.modal.linkNote")}</s-paragraph>}
          {m.to && <s-text-field label={t("message.modal.to")} value={m.to} readOnly />}
          <s-text-field label={t("message.modal.subject")} value={m.subject} readOnly />
          <div dir={m.dir} lang={m.locale}>
            <s-text-area label={t("message.modal.body")} value={m.body} rows={12} readOnly />
          </div>
        </s-stack>
      )}
      <s-button slot="primary-action" variant="primary" onClick={copy}>{t("message.modal.copy")}</s-button>
      {m && (
        <s-button slot="secondary-actions" href={m.mailto} target="_blank">{t("message.modal.mailto")}</s-button>
      )}
      <s-button slot="secondary-actions" onClick={p.onClose}>{t("message.modal.close")}</s-button>
    </Modal>
  );
}
