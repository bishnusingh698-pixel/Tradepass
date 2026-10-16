import { authenticate } from "../shopify.server";
import db from "../db.server";
import { readSettings, type Settings } from "./settings";
import { effectivePlan, type PlanId } from "./plans";
import { createT, type Translator } from "./i18n";
import { adminLocale } from "./i18n/server";
import { staffActor } from "./activity.server";

/**
 * Everything an admin loader/action usually needs, in one call:
 * Shopify auth, our Shop row, settings with defaults, effective plan, a
 * server-side translator in the merchant's admin language, and the actor name
 * for the activity log. Every DB query in a route must filter by `shop`.
 */
export async function adminContext(request: Request) {
  const { session, admin, billing, redirect } = await authenticate.admin(request);
  const shop = session.shop;
  const row = await db.shop.findUnique({ where: { shop } });
  const settings: Settings = readSettings(row?.settings ?? {});
  const plan: PlanId = effectivePlan(row?.billingPlan ?? "free", Boolean(row?.isDevStore));
  const locale = adminLocale(request, row?.primaryLocale);
  const i18n: Translator = createT(locale, { overrides: settings.texts });
  return {
    session,
    admin,
    billing,
    redirect,
    shop,
    shopRow: row,
    settings,
    plan,
    isPlus: Boolean(row?.isPlus),
    i18n,
    t: i18n.t,
    actor: staffActor(session),
  };
}

export type AdminContext = Awaited<ReturnType<typeof adminContext>>;
