import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { updateSettings } from "../lib/settings.server";
import { logActivity } from "../lib/activity.server";
import { LOCALES } from "../lib/i18n/locales";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { REPLY_LIMITS, sanitizeReplies, type ReplyKind } from "../lib/replies";
import { MAX_REPLIES, type SavedReply } from "../lib/settings";

// Settings → Saved replies (B9): rejection reasons and "more info" messages, per language, in order.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const primary = ctx.shopRow?.primaryLocale ?? "en";
  return { replies: ctx.settings.replies, primary, locales: [primary, ...LOCALES.filter((c) => c !== primary)] };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form.get("replies") ?? "null"));
  } catch {
    return { ok: false as const };
  }
  const replies = sanitizeReplies(raw);
  await updateSettings(ctx.shop, { replies });
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "settings.replies", subject: null, detail: { reject: replies.reject.length, info: replies.info.length } });
  return { ok: true as const, replies };
};

export default function SavedReplies() {
  const d = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [replies, setReplies] = useState(d.replies);
  const [lang, setLang] = useState(d.primary);
  const langName = (code: string) => {
    try {
      return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  // The saved (cleaned) replies replace the edited ones once the save returns ("adjust state during render").
  const [savedSeen, setSavedSeen] = useState<unknown>(null);
  if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data !== savedSeen) {
    setSavedSeen(fetcher.data);
    setReplies(fetcher.data.replies);
  }
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    shopify.toast.show(t(fetcher.data.ok ? "common.saved" : "errors.generic"), { isError: !fetcher.data.ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const update = (kind: ReplyKind, i: number, patch: Partial<{ title: string; text: string }>) =>
    setReplies((r) => {
      const list = [...r[kind]];
      const cur = list[i];
      const now = cur.texts[lang] ?? { title: "", text: "" };
      list[i] = { ...cur, texts: { ...cur.texts, [lang]: { ...now, ...patch } } };
      return { ...r, [kind]: list };
    });
  const move = (kind: ReplyKind, i: number, by: number) =>
    setReplies((r) => {
      const list = [...r[kind]];
      const j = i + by;
      if (j < 0 || j >= list.length) return r;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...r, [kind]: list };
    });
  const remove = (kind: ReplyKind, i: number) => setReplies((r) => ({ ...r, [kind]: r[kind].filter((_, x) => x !== i) }));
  const add = (kind: ReplyKind) =>
    setReplies((r) => (r[kind].length >= MAX_REPLIES ? r : { ...r, [kind]: [...r[kind], { id: "", texts: { [lang]: { title: "", text: "" } } } as SavedReply] }));
  const save = () => fetcher.submit({ replies: JSON.stringify(replies) }, { method: "POST" });

  const list = (kind: ReplyKind) => (
    <s-section heading={t(`settings.replies.${kind}.heading`)}>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t(`settings.replies.${kind}.body`)}</s-paragraph>
        {replies[kind].map((r, i) => {
          const cur = r.texts[lang] ?? { title: "", text: "" };
          return (
            <s-box key={`${r.id}-${i}`} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-text-field label={t("settings.replies.title")} value={cur.title} maxLength={REPLY_LIMITS.title}
                  onInput={(e) => update(kind, i, { title: (e.currentTarget as unknown as HTMLInputElement).value })} />
                <s-text-area label={t("settings.replies.text")} value={cur.text} maxLength={REPLY_LIMITS.text} rows={4}
                  details={Object.keys(r.texts).length > 1 ? t("settings.replies.languages", { count: Object.keys(r.texts).length }) : undefined}
                  onInput={(e) => update(kind, i, { text: (e.currentTarget as unknown as HTMLTextAreaElement).value })} />
                <s-stack direction="inline" gap="small-200">
                  <s-button variant="tertiary" disabled={i === 0} onClick={() => move(kind, i, -1)} accessibilityLabel={t("settings.replies.upFor", { title: cur.title })}>{t("settings.replies.up")}</s-button>
                  <s-button variant="tertiary" disabled={i === replies[kind].length - 1} onClick={() => move(kind, i, 1)} accessibilityLabel={t("settings.replies.downFor", { title: cur.title })}>{t("settings.replies.down")}</s-button>
                  <s-button variant="tertiary" tone="critical" onClick={() => remove(kind, i)} accessibilityLabel={t("settings.replies.deleteFor", { title: cur.title })}>{t("settings.replies.delete")}</s-button>
                </s-stack>
              </s-stack>
            </s-box>
          );
        })}
        <s-button onClick={() => add(kind)} disabled={replies[kind].length >= MAX_REPLIES}>{t("settings.replies.add")}</s-button>
      </s-stack>
    </s-section>
  );

  return (
    <s-page heading={t("settings.replies.heading")}>
      <s-link slot="breadcrumb-actions" href={href("/app/settings")}>{t("settings.title")}</s-link>
      <s-button slot="primary-action" variant="primary" loading={fetcher.state !== "idle"} onClick={save}>{t("common.save")}</s-button>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.replies.intro")}</s-paragraph>
          <s-select label={t("settings.replies.language")} value={lang} onChange={(e) => setLang((e.currentTarget as unknown as HTMLSelectElement).value)}>
            {d.locales.map((c) => (
              <s-option key={c} value={c}>{langName(c)}</s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>
      {list("reject")}
      {list("info")}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
