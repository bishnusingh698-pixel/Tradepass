import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { refreshShopFacts } from "./lib/shop.server";
import { ensureDefaults } from "./lib/defaults.server";
import { BILLING_NAMES, PLANS } from "./lib/plans";

// Paid plans (feature spec §N): monthly, USD, 14-day trial. Switching plans
// replaces the current subscription immediately (Shopify prorates).
const paidPlan = (price: number, trialDays: number) => ({
  trialDays,
  replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
  lineItems: [{ amount: price, currencyCode: "USD", interval: BillingInterval.Every30Days as const }],
});

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [BILLING_NAMES.starter]: paidPlan(PLANS.starter.price, PLANS.starter.trialDays),
    [BILLING_NAMES.pro]: paidPlan(PLANS.pro.price, PLANS.pro.trialDays),
  },
  hooks: {
    // Runs on install and reinstall. Both steps are idempotent (upserts /
    // create-if-missing), so a reinstall never duplicates defaults.
    afterAuth: async ({ session, admin }) => {
      await refreshShopFacts(session.shop, admin);
      await ensureDefaults(session.shop);
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
