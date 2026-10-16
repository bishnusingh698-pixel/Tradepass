import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { supportEmail: process.env.SUPPORT_EMAIL ?? "" };
};

export default function Help() {
  const { supportEmail } = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  return (
    <s-page heading={t("help.title")}>
      <s-section heading={t("help.empty.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("help.empty.body")}</s-paragraph>
          <s-paragraph tone="neutral">{t("common.comingSoon")}</s-paragraph>
          {supportEmail && (
            <s-link href={`mailto:${supportEmail}`}>{t("help.contact", { email: supportEmail })}</s-link>
          )}
          <s-link href={href("/app/diagnostics")}>{t("spike.title")}</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
