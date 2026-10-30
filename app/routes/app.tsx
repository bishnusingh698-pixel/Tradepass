import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { adminLocale, i18nPayload } from "../lib/i18n/server";
import { I18nProvider, useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { shop: session.shop }, select: { primaryLocale: true } });

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", i18n: i18nPayload(adminLocale(request, shop?.primaryLocale)) };
};

// Nine sections. Certificates and Import are tabs of Wholesale buyers;
// Notifications and Automation are tabs of Emails & automation (SectionTabs);
// Plans is reached from Settings and from every "Available on …" label.
const NAV = [
  ["/app/applications", "nav.applications"],
  ["/app/buyers", "nav.wholesaleBuyers"],
  ["/app/tiers", "nav.tiers"],
  ["/app/form", "nav.applicationForm"],
  ["/app/storefront", "nav.storefrontAccess"],
  ["/app/notifications", "nav.emailsAutomation"],
  ["/app/settings", "nav.settings"],
  ["/app/help", "nav.help"],
] as const;

function Nav() {
  const { t } = useI18n();
  const href = useLocaleHref();
  return (
    <s-app-nav>
      <s-link href={href("/app")}>
        {t("nav.home")}
      </s-link>
      {NAV.map(([path, key]) => (
        <s-link key={path} href={href(path)}>
          {t(key)}
        </s-link>
      ))}
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey, i18n } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <I18nProvider value={i18n}>
        <div dir={i18n.dir} lang={i18n.locale}>
          <Nav />
          <Outlet />
        </div>
      </I18nProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
