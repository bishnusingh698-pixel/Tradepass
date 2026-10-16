import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { cleanupSpike, runSpike, type SpikeReport } from "../lib/spike.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

// Help → Diagnostics → B2B compatibility test (the Phase 0 spike).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { shop: session.shop }, select: { isDevStore: true } });
  const last = await db.activityLog.findFirst({
    where: { shop: session.shop, action: "spike.run" },
    orderBy: { createdAt: "desc" },
  });
  return { isDevStore: Boolean(shop?.isDevStore), report: (last?.detail as SpikeReport | null) ?? null, lastId: last?.id ?? null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "run") {
    const report = await runSpike(admin.graphql);
    await db.activityLog.create({
      data: { shop: session.shop, actor: "staff", action: "spike.run", result: report.conclusion.moveWorks ? "ok" : "failed", detail: report as object },
    });
    return { ok: true };
  }
  if (intent === "cleanup") {
    const last = await db.activityLog.findFirst({ where: { shop: session.shop, action: "spike.run" }, orderBy: { createdAt: "desc" } });
    const report = last?.detail as SpikeReport | undefined;
    if (!last || !report) return { ok: false };
    const steps = await cleanupSpike(admin.graphql, report.created);
    await db.activityLog.update({
      where: { id: last.id },
      data: { detail: { ...report, created: { companies: [], markets: [], catalogs: [] }, cleanup: steps } as object },
    });
    return { ok: true };
  }
  return { ok: false };
};

export default function Diagnostics() {
  const { isDevStore, report } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useI18n();
  const href = useLocaleHref();
  const busy = fetcher.state !== "idle";
  const passed = report?.conclusion.moveWorks === true && report?.conclusion.addWorks === true;
  const leftovers = report ? Object.values(report.created).some((ids) => ids.length > 0) : false;

  return (
    <s-page heading={t("spike.title")}>
      <s-link slot="breadcrumb-actions" href={href("/app/help")}>{t("nav.help")}</s-link>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("spike.intro")}</s-paragraph>
          {!isDevStore && <s-banner tone="info">{t("spike.devOnly")}</s-banner>}
          {busy && <s-paragraph>{t("spike.running")}</s-paragraph>}
          {report && !busy && (
            <s-banner tone={passed ? "success" : "warning"}>{passed ? t("spike.passed") : t("spike.failed")}</s-banner>
          )}
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              disabled={!isDevStore || busy}
              onClick={() => fetcher.submit({ intent: "run" }, { method: "POST" })}
            >
              {t("spike.run")}
            </s-button>
            {leftovers && (
              <s-button disabled={busy} onClick={() => fetcher.submit({ intent: "cleanup" }, { method: "POST" })}>
                {t("spike.cleanup")}
              </s-button>
            )}
            {report && (
              <s-button
                variant="tertiary"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
                  shopify.toast.show(t("common.saved"));
                }}
              >
                {t("spike.copy")}
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>
      {report && (
        <s-section>
          <s-box padding="base" background="subdued" borderRadius="base">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
              {JSON.stringify(report.conclusion, null, 2)}
            </pre>
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
