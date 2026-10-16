import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { refreshShopFacts } from "../lib/shop.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  // Spec: detect plan and B2B entitlements on each Home load.
  const facts = await refreshShopFacts(session.shop, admin);
  const pending = await db.application.count({ where: { shop: session.shop, status: "pending" } });
  return { facts, pending };
};

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-badge tone={ok ? "success" : "warning"} icon={ok ? "check" : "alert-triangle"} />
      <s-text>{children}</s-text>
    </s-stack>
  );
}

export default function Home() {
  const { facts, pending } = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const revalidator = useRevalidator();
  const limit = facts.catalogLimit ?? 0;
  const used = facts.catalogsUsed ?? 0;
  const budgetOk = facts.isPlus || limit === 0 || used < limit;

  return (
    <s-page heading={t("home.title")}>
      <s-section heading={t("home.readiness.heading")}>
        <s-stack direction="block" gap="base">
          <s-text>{t("home.readiness.plan", { plan: facts.planName })}</s-text>
          <Status ok={facts.b2bEnabled}>
            {facts.b2bEnabled ? t("home.readiness.b2bOn") : t("home.readiness.b2bOff")}
          </Status>
          {facts.b2bEnabled && !facts.isPlus && (
            <Status ok={facts.b2bMarketsEnabled}>
              {facts.b2bMarketsEnabled ? t("home.readiness.marketsOn") : t("home.readiness.marketsOff")}
            </Status>
          )}
          {facts.b2bEnabled && (
            <Status ok={budgetOk}>
              {facts.isPlus || limit === 0
                ? t("home.readiness.catalogUnlimited", { used })
                : t("home.readiness.catalogBudget", { used, limit })}
            </Status>
          )}
          <s-stack direction="inline" gap="base">
            {!facts.b2bEnabled && (
              <s-button href="https://www.shopify.com/pricing" target="_blank">
                {t("home.readiness.viewPlans")}
              </s-button>
            )}
            <s-button
              variant="tertiary"
              onClick={() => revalidator.revalidate()}
              {...(revalidator.state === "loading" ? { loading: true } : {})}
            >
              {t("home.readiness.refresh")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("home.pending.heading")}>
        {pending > 0 ? (
          <s-link href={href("/app/applications")}>{t("home.pending.applications", { count: pending })}</s-link>
        ) : (
          <s-paragraph>{t("home.pending.none")}</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
