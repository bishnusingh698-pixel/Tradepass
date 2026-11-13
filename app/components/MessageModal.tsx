import { useAppBridge } from "@shopify/app-bridge-react";
import { useI18n } from "../lib/i18n/react";
import type { ApplicantMessage } from "../lib/messages";
import { channelLinks, type Channel, type ChannelLink } from "../lib/message-links";
import { Modal } from "./form-builder/wc";

// Tradepass doesn't send email or texts (D-091). After "Ask for more information", "Reject",
// "Copy renewal link" or for an approved buyer, the merchant gets the ready-made message in the
// recipient's language and sends it from their own apps: copy it, or open it in their mail app,
// Gmail, Outlook on the web, WhatsApp, their phone's text messages, Telegram or LINE. Only links:
// no API, no account, no cost. When a message is too long for an app's link, the app opens without
// the text and the message is copied first, so the merchant just pastes it.

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

/** The channels shown first; the rest (Telegram, LINE) are under "More apps". */
const MAIN: Channel[] = ["mailto", "gmail", "outlook", "whatsapp", "sms"];

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
  const links = m ? channelLinks({ to: m.to, phone: m.phone, subject: m.subject, body: m.body, link: m.link }) : [];
  // Too long for this app's link: copy first, then open the app without the text.
  const onOpen = (l: ChannelLink) => async () => {
    if (!l.withoutText || !m) return;
    const ok = await copyText(m.body);
    shopify.toast.show(t(ok ? "message.modal.pasteHint" : "message.modal.copyFailed"), { isError: !ok });
  };
  const button = (l: ChannelLink) => (
    <s-button key={l.channel} href={l.href} target="_blank" onClick={onOpen(l)}>
      {t(`message.channel.${l.channel}`)}
    </s-button>
  );
  return (
    <Modal id={p.id} heading={t("message.modal.heading", { company: p.company })} open={Boolean(m)} onClose={p.onClose}>
      {m && (
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("message.modal.intro", { language })}</s-paragraph>
          {p.withLink && <s-paragraph color="subdued">{t("message.modal.linkNote")}</s-paragraph>}
          {m.to && <s-text-field label={t("message.modal.to")} value={m.to} readOnly />}
          {m.phone && <s-text-field label={t("message.modal.phone")} value={m.phone} readOnly />}
          <s-text-field label={t("message.modal.subject")} value={m.subject} readOnly />
          <div dir={m.dir} lang={m.locale}>
            <s-text-area label={t("message.modal.body")} value={m.body} rows={12} readOnly />
          </div>
          <s-stack direction="block" gap="small-200">
            <s-text type="strong">{t("message.modal.openIn")}</s-text>
            <s-stack direction="inline" gap="small-200">{links.filter((l) => MAIN.includes(l.channel)).map(button)}</s-stack>
            {links.some((l) => !MAIN.includes(l.channel)) && (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">{t("message.modal.moreApps")}</s-text>
                {links.filter((l) => !MAIN.includes(l.channel)).map(button)}
              </s-stack>
            )}
            {!m.phone && <s-text color="subdued">{t("message.modal.noPhone")}</s-text>}
            <s-text color="subdued">{t("message.modal.nothingSent")}</s-text>
          </s-stack>
        </s-stack>
      )}
      <s-button slot="primary-action" variant="primary" onClick={copy}>{t("message.modal.copy")}</s-button>
      <s-button slot="secondary-actions" onClick={p.onClose}>{t("message.modal.close")}</s-button>
    </Modal>
  );
}
