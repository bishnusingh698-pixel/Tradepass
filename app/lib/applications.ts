import { riskHints, type RiskHint } from "./risk";
// Applications queue constants shared by the server and the queue page.
export const TABS = ["pending", "needs_info", "approved", "rejected", "all"] as const;
export type Tab = (typeof TABS)[number];

/** Whole days an application has been waiting (C12). */
export function waitingDays(submittedAt: string | Date, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(submittedAt).getTime()) / 86_400_000));
}

type AddressLike = Record<string, unknown> | null | undefined;
const addressLine = (a: AddressLike) => (a ? [a.address1, a.address2].filter((x) => typeof x === "string").join(" ") : "");

/** Risk hints for a stored application (C14): never block, only shown and usable in rules. */
export function riskForApplication(app: { email: string; companyName: string; taxCheckName: string | null; answers: unknown }): RiskHint[] {
  const a = (app.answers ?? {}) as Record<string, unknown>;
  const ship = a.shippingAddress as AddressLike;
  return riskHints({
    email: app.email,
    website: typeof a.website === "string" ? a.website : null,
    storeUrl: typeof a.storeUrl === "string" ? a.storeUrl : null,
    companyName: app.companyName,
    registryName: app.taxCheckName,
    billingLine: addressLine(a.billingAddress as AddressLike),
    shippingLine: addressLine(ship),
    shippingSame: !ship || (ship as Record<string, unknown>).same === true ? true : false,
  });
}
