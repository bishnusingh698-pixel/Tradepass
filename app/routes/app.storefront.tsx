import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { EmptyPage } from "../components/EmptyPage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Page() {
  return <EmptyPage section="storefront" actionHref="/app/storefront" />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
