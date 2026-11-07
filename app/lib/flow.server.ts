import { createHmac } from "node:crypto";
import db from "../db.server";
import { mutate, numericId, UserErrorsError, type Admin } from "./gql.server";
import { logActivity } from "./activity.server";
import { can, effectivePlan } from "./plans";
import { safeEqual } from "./crypto.server";
import { tryLock, unlock } from "./lock.server";
import { APPROVAL_STEPS, ApprovalError, approvalDefaults, approveApplication } from "./approval.server";
import { errorCodeOf } from "./rules";
import { createT } from "./i18n";
import { readSettings } from "./settings";

// Shopify Flow triggers (spec §K, Pro). Each trigger is a `flow_trigger`
// extension in extensions/tradepass-flow-<name>; its [[settings.fields]] must
// match TRIGGER_FIELDS below exactly (tests/automation-flow.test.ts checks).

export type FlowTrigger =
  | "application_submitted" | "application_approved" | "application_rejected" | "application_info_received"
  | "certificate_expiring" | "certificate_expired";

export type FlowPayload = {
  applicationId?: string;
  buyerId?: string;
  companyGid?: string;
  companyName?: string;
  contactEmail?: string;
  country?: string;
  tierName?: string;
  expiryDate?: string;
  contactName?: string;
  phone?: string;
  /** US state / province code of the billing address (or the certificate's state). */
  state?: string;
  /** Link that opens the application (or the buyer) in Tradepass inside Shopify admin. */
  adminUrl?: string;
};

/** Extension handle per trigger (flowTriggerReceive's `handle`). */
export const TRIGGER_HANDLES: Record<FlowTrigger, string> = {
  application_submitted: "tradepass-flow-application-submitted",
  application_approved: "tradepass-flow-application-approved",
  application_rejected: "tradepass-flow-application-rejected",
  application_info_received: "tradepass-flow-application-info-received",
  certificate_expiring: "tradepass-flow-certificate-expiring",
  certificate_expired: "tradepass-flow-certificate-expired",
};

// Flow field keys: letters and spaces only, sent verbatim. `company_id` is the
// payload key of a `company_reference` field (numeric id).
type FieldKey =
  | "company_id" | "Application ID" | "Buyer ID" | "Company name" | "Contact email" | "Country" | "Tier" | "Expiry date"
  | "Admin URL" | "Contact name" | "Phone" | "State";

/** Fields every alert recipe needs (B8): id, admin link, company, contact, email, phone, country, state, tier. */
const APPLICATION_FIELDS: FieldKey[] = ["Application ID", "Admin URL", "Company name", "Contact name", "Contact email", "Phone", "Country", "State", "Tier"];

export const TRIGGER_FIELDS: Record<FlowTrigger, FieldKey[]> = {
  application_submitted: APPLICATION_FIELDS,
  application_approved: ["company_id", ...APPLICATION_FIELDS, "Buyer ID"],
  application_rejected: APPLICATION_FIELDS,
  application_info_received: APPLICATION_FIELDS,
  certificate_expiring: ["company_id", "Buyer ID", "Admin URL", "Company name", "Contact email", "Country", "State", "Tier", "Expiry date"],
  certificate_expired: ["company_id", "Buyer ID", "Admin URL", "Company name", "Contact email", "Country", "State", "Tier", "Expiry date"],
};

/** Flow field type per key (`url` for the admin link, plain text otherwise; the company is a reference). */
export const FIELD_TYPES: Record<FieldKey, string> = {
  company_id: "company_reference", "Admin URL": "url", "Application ID": "single_line_text_field", "Buyer ID": "single_line_text_field",
  "Company name": "single_line_text_field", "Contact email": "single_line_text_field", Country: "single_line_text_field", Tier: "single_line_text_field",
  "Expiry date": "single_line_text_field", "Contact name": "single_line_text_field", Phone: "single_line_text_field", State: "single_line_text_field",
};

/**
 * The application's page in Shopify admin (embedded Tradepass), for Flow emails and Slack posts.
 * Uses the app's client ID, which the admin resolves to the installed app (verify on a dev store).
 */
export function adminUrl(shop: string, path: string): string {
  const handle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/apps/${encodeURIComponent(process.env.SHOPIFY_API_KEY ?? "")}${path}`;
}

/** What every application trigger carries, from the stored application (no Shopify call). */
export async function applicationPayload(shop: string, applicationId: string, extra: FlowPayload = {}): Promise<FlowPayload> {
  const app = await db.application.findFirst({ where: { shop, id: applicationId } });
  if (!app) return { applicationId, ...extra };
  const a = (app.answers ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const billing = (a.billingAddress ?? {}) as Record<string, unknown>;
  const tierId = app.suggestedTierId;
  const tier = !extra.tierName && tierId ? await db.tier.findFirst({ where: { shop, id: tierId }, select: { name: true } }) : null;
  return {
    applicationId: app.id,
    adminUrl: adminUrl(shop, `/app/applications/${app.id}`),
    companyName: app.companyName,
    contactName: [s(a.firstName), s(a.lastName)].filter(Boolean).join(" "),
    contactEmail: app.email,
    phone: s(a.phone),
    country: app.countryCode ?? undefined,
    state: s(billing.zoneCode),
    tierName: tier?.name,
    ...extra,
  };
}

/** Flow rejects payloads of 50,000 bytes or more (keys included). */
export const MAX_PAYLOAD_BYTES = 50_000;
const MAX_TEXT = 1000;

const clip = (v: string | undefined) => (v ?? "").slice(0, MAX_TEXT);

/**
 * Build the trigger payload. Every field the extension declares is sent
 * (empty string when unknown) so Flow conditions never see a missing key.
 * Returns null when a required company reference is missing or the payload is too large.
 */
export function buildFlowPayload(trigger: FlowTrigger, p: FlowPayload): Record<string, string | number> | null {
  const values: Record<FieldKey, string | number | null> = {
    company_id: p.companyGid ? Number(numericId(p.companyGid)) : null,
    "Application ID": clip(p.applicationId),
    "Buyer ID": clip(p.buyerId),
    "Company name": clip(p.companyName),
    "Contact email": clip(p.contactEmail),
    Country: clip(p.country),
    Tier: clip(p.tierName),
    "Expiry date": clip(p.expiryDate),
    "Admin URL": clip(p.adminUrl),
    "Contact name": clip(p.contactName),
    Phone: clip(p.phone),
    State: clip(p.state),
  };
  const out: Record<string, string | number> = {};
  for (const key of TRIGGER_FIELDS[trigger]) {
    const v = values[key];
    if (v === null || (typeof v === "number" && !Number.isFinite(v))) return null;
    out[key] = v;
  }
  return payloadBytes(out) < MAX_PAYLOAD_BYTES ? out : null;
}

export function payloadBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

async function flowAllowed(shop: string): Promise<boolean> {
  const row = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true, isDevStore: true } });
  return Boolean(row) && can(effectivePlan(row!.billingPlan, row!.isDevStore), "flow");
}

const RECEIVE = `#graphql
mutation TradepassFlowTrigger($handle: String!, $payload: JSON!) {
  flowTriggerReceive(handle: $handle, payload: $payload) { userErrors { field message } }
}`;

/** Fire a Flow trigger if the shop's plan includes Flow. Never throws (failures are logged to the activity log). */
export async function emitFlowTrigger(admin: Admin, shop: string, trigger: FlowTrigger, payload: FlowPayload): Promise<void> {
  const subject = payload.applicationId ?? payload.buyerId ?? null;
  try {
    if (!(await flowAllowed(shop))) return;
    const body = buildFlowPayload(trigger, payload);
    if (!body) {
      await logActivity({ shop, actor: "flow", action: `flow.${trigger}`, subject, result: "failed", detail: { error: "invalid_payload" } });
      return;
    }
    await mutate(admin, "flowTriggerReceive", RECEIVE, { handle: TRIGGER_HANDLES[trigger], payload: body });
  } catch (e) {
    // Only our own error text (codes/messages from Shopify), never payload values.
    await logActivity({
      shop, actor: "flow", action: `flow.${trigger}`, subject, result: "failed",
      detail: { error: (e as Error).message.slice(0, 200) },
    }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Flow action "Approve wholesale application to tier" (POST /flow/approve).

export const ACTION_HANDLE = "tradepass-flow-approve-application";
export const ACTION_FIELDS = { applicationId: "Application ID", tier: "Tier", sendWelcome: "Send welcome email" } as const;
// Flow waits 10 s; answer before that and let a long approval finish in the background.
export const ACTION_WAIT_MS = 8_000;

export type FlowActionRequest = {
  shop_id?: number;
  shopify_domain?: string;
  action_run_id?: string;
  handle?: string;
  properties?: Record<string, unknown>;
};

/** Flow signs action requests like webhooks: base64 HMAC-SHA256 of the raw body with the app's API secret. */
export function verifyFlowHmac(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(digest, header);
}

export type FlowActionResult = { status: number; body: { message?: string; [k: string]: unknown }; headers?: Record<string, string> };

/**
 * Run the approval for a verified Flow request. Status codes follow Flow's rules:
 * 200 done (no retry) · 202 still running (Flow retries) · 4xx permanent failure
 * with a `message` the merchant sees in Flow (no retry).
 */
export async function handleFlowApprove(admin: Admin, shop: string, req: FlowActionRequest): Promise<FlowActionResult> {
  const row = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true, isDevStore: true, primaryLocale: true, uninstalledAt: true, settings: true } });
  const { t } = createT(row?.primaryLocale ?? "en", { overrides: readSettings(row?.settings ?? {}).texts });
  if (!row || row.uninstalledAt) return { status: 410, body: { message: t("flow.action.notInstalled") } };
  if (!can(effectivePlan(row.billingPlan, row.isDevStore), "flow")) {
    return { status: 403, body: { message: t("flow.action.planRequired", { plan: "Pro" }) } };
  }
  const props = req.properties ?? {};
  const applicationId = String(props[ACTION_FIELDS.applicationId] ?? "").trim();
  const tierName = String(props[ACTION_FIELDS.tier] ?? "").trim();
  const sendWelcome = props[ACTION_FIELDS.sendWelcome];

  const app = applicationId ? await db.application.findFirst({ where: { shop, id: applicationId }, select: { id: true, status: true } }) : null;
  if (!app) return { status: 404, body: { message: t("flow.action.notFound") } };
  if (app.status === "approved") return { status: 200, body: { message: t("flow.action.alreadyApproved") } };
  if (!["pending", "needs_info"].includes(app.status)) return { status: 409, body: { message: t("flow.action.notOpen") } };

  let tierId: string | null = null;
  if (tierName) {
    const tier = await db.tier.findFirst({ where: { shop, name: { equals: tierName, mode: "insensitive" } }, select: { id: true } });
    if (!tier) return { status: 422, body: { message: t("flow.action.tierNotFound", { tier: tierName }) } };
    tierId = tier.id;
  }

  // One run per application at a time; a duplicate or retried request while it runs gets 202.
  const holder = await tryLock(shop, `flow-approve:${app.id}`, 5 * 60_000);
  if (!holder) return { status: 202, body: { message: t("flow.action.running") } };

  const ctx = { admin, shop, actor: "flow" };
  const run = (async (): Promise<FlowActionResult> => {
    try {
      const defaults = await approvalDefaults(ctx, app.id);
      const input = { ...defaults.input, tierId: tierId ?? defaults.input.tierId };
      if (typeof sendWelcome === "boolean") input.sendWelcome = sendWelcome;
      if (!input.tierId) return { status: 422, body: { message: t("flow.action.noTier") } };
      const state = await approveApplication(ctx, app.id, input);
      const failed = APPROVAL_STEPS.find((s) => state.steps[s]?.status === "failed");
      await logActivity({ shop, actor: "flow", action: "flow.approve", subject: app.id, result: failed ? "failed" : "ok", detail: failed ? { step: failed } : undefined });
      // Only the welcome email failing still leaves an approved buyer: that's a success for Flow
      // (the merchant can send the email again from the application).
      if (failed && failed !== "email") return { status: 422, body: { message: t("flow.action.stepFailed") } };
      return { status: 200, body: {} };
    } catch (e) {
      await logActivity({ shop, actor: "flow", action: "flow.approve", subject: app.id, result: "failed", detail: { error: errorCodeOf(e) } }).catch(() => undefined);
      // Shopify-side validation errors won't fix themselves; anything else may be transient (Flow retries 5xx).
      if (e instanceof UserErrorsError) return { status: 422, body: { message: t("flow.action.stepFailed") } };
      // Plan limit, no B2B, already being approved…: retrying won't help, so tell the merchant why.
      if (e instanceof ApprovalError) return { status: e.code === "busy" ? 202 : 422, body: { message: t(`approval.blocked.${e.code}`) } };
      return { status: 500, body: { message: t("flow.action.tryLater") } };
    } finally {
      await unlock(shop, `flow-approve:${app.id}`, holder);
    }
  })();

  const timeout = new Promise<FlowActionResult>((resolve) =>
    setTimeout(() => resolve({ status: 202, body: { message: t("flow.action.running") } }), ACTION_WAIT_MS).unref?.(),
  );
  return Promise.race([run, timeout]);
}
