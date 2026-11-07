import { useMemo, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useI18n } from "../lib/i18n/react";
import { qrSvg, trackedUrl } from "../lib/qr";
import { saveBlob } from "./download";

// "Share the form" (C17): copy the form's address, or download a QR code made right here (no outside
// service) for trade shows and catalogues. The QR address carries utm_source=qr, so those
// applications show up as "qr" under "Where they came from".
export function ShareForm({ url }: { url: string }) {
  const { t } = useI18n();
  const shopify = useAppBridge();
  const [tracked, setTracked] = useState(true);
  const link = tracked ? trackedUrl(url) : url;
  const svg = useMemo(() => qrSvg(link, 512), [link]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      shopify.toast.show(t("form.share.copied"));
    } catch {
      shopify.toast.show(t("message.modal.copyFailed"), { isError: true });
    }
  };
  const png = () => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 1024;
      c.getContext("2d")!.drawImage(img, 0, 0, 1024, 1024);
      c.toBlob((b) => b && saveBlob(b, "wholesale-form-qr.png"), "image/png");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  return (
    <s-section heading={t("form.share.heading")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("form.share.body")}</s-paragraph>
        <s-text-field label={t("form.share.url")} value={url} readOnly />
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={copy}>{t("form.share.copy")}</s-button>
          <s-button onClick={png}>{t("form.share.png")}</s-button>
          <s-button onClick={() => saveBlob(new Blob([svg], { type: "image/svg+xml" }), "wholesale-form-qr.svg")}>{t("form.share.svg")}</s-button>
        </s-stack>
        <s-checkbox label={t("form.share.track")} details={t("form.share.trackHelp")} checked={tracked} onChange={(e) => setTracked((e.currentTarget as unknown as HTMLInputElement).checked)} />
        {/* The SVG is our own output (only rects in a path), so it's safe to show inline. */}
        <div style={{ inlineSize: 160 }} role="img" aria-label={t("form.share.qrLabel")} dangerouslySetInnerHTML={{ __html: svg }} />
      </s-stack>
    </s-section>
  );
}
