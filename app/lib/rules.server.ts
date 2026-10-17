import db from "../db.server";
import type { Admin } from "./gql.server";
import { logActivity } from "./activity.server";
import { can, effectivePlan } from "./plans";
import { readSettings } from "./settings";
import { APPROVAL_STEPS, approvalDefaults, approveApplication, undoApproval, type ApprovalCtx } from "./approval.server";
import { rejectApplication } from "./applications.server";
import { pauseBuyers } from "./buyers.server";
import { domainOf, errorCodeOf, MAX_RULES, pickRule, type ApproveAction, type RejectAction, type RuleConditions, type RuleDef, type ApplicationFacts } from "./rules";

export * from "./rules";

// Automation rules (spec §K, Pro). On each new application: auto-reject rules
// first (spam, blocked domains/countries), then auto-approve rules, each list in
// `position` order; the first match decides. "Pause all automation" and the
// daily auto-approval limit are checked before anything happens. Every
// decision is stored on Application.autoRuleId, logged with actor "automation",
// and can be reversed (reverseAutoDecision).

export type RuleOutcome = { decided: "approved" | "rejected" | null; ruleId?: string };

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Auto-approvals already made today (UTC), for the daily limit. */
export async function autoApprovalsToday(shop: string, now = new Date()): Promise<number> {
  return db.application.count({ where: { shop, autoRuleId: { not: null }, status: "approved", decidedAt: { gte: startOfUtcDay(now) } } });
}

async function factsFor(shop: string, applicationId: string) {
  const app = await db.application.findFirst({ where: { shop, id: applicationId } });
  if (!app) return null;
  const [files, certs] = await Promise.all([
    db.applicationFile.count({ where: { shop, applicationId, kind: "certificate" } }),
    db.certificate.count({ where: { shop, applicationId } }),
  ]);
  const facts: ApplicationFacts = {
    country: app.countryCode,
    businessType: app.businessType,
    emailDomain: domainOf(app.email),
    taxVerified: app.taxCheck === "verified",
    hasCertificate: files + certs > 0,
    flags: app.flags,
    answers: (app.answers ?? {}) as Record<string, unknown>,
  };
  return { app, facts };
}

const ACTOR = "automation";


/** Run auto-reject then auto-approve rules on a newly submitted application (Pro; respects Pause + daily limit). Never throws. */
export async function evaluateRules(admin: Admin, shop: string, applicationId: string): Promise<RuleOutcome> {
  try {
    const shopRow = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true, isDevStore: true, settings: true } });
    if (!shopRow || !can(effectivePlan(shopRow.billingPlan, shopRow.isDevStore), "auto_rules")) return { decided: null };
    const settings = readSettings(shopRow.settings);
    if (settings.automation.paused) return { decided: null };

    const found = await factsFor(shop, applicationId);
    if (!found || found.app.status !== "pending" || found.app.autoRuleId) return { decided: null };

    const rules = (await db.rule.findMany({ where: { shop, enabled: true } })) as unknown as (RuleDef & { id: string })[];
    const rule = pickRule(rules, found.facts);
    if (!rule) return { decided: null };
    const ctx: ApprovalCtx = { admin, shop, actor: ACTOR };

    if (rule.kind === "reject") {
      const a = rule.action as RejectAction;
      const ok = await rejectApplication(ctx, applicationId, { reason: a.reason ?? null, email: Boolean(a.email) });
      if (!ok) return { decided: null };
      await db.application.updateMany({ where: { shop, id: applicationId }, data: { autoRuleId: rule.id } });
      await logActivity({ shop, actor: ACTOR, action: "automation.reject", subject: applicationId, detail: { ruleId: rule.id } });
      return { decided: "rejected", ruleId: rule.id };
    }

    if ((await autoApprovalsToday(shop)) >= settings.automation.dailyLimit) {
      await logActivity({ shop, actor: ACTOR, action: "automation.limit_reached", subject: applicationId, detail: { ruleId: rule.id, limit: settings.automation.dailyLimit } });
      return { decided: null };
    }
    const a = rule.action as ApproveAction;
    const tier = await db.tier.findFirst({ where: { shop, id: a.tierId }, select: { id: true } });
    if (!tier) {
      await logActivity({ shop, actor: ACTOR, action: "automation.approve", subject: applicationId, result: "failed", detail: { ruleId: rule.id, error: "tier_missing" } });
      return { decided: null };
    }
    const defaults = await approvalDefaults(ctx, applicationId);
    const input = {
      ...defaults.input,
      tierId: tier.id,
      paymentTermsTemplateId: a.paymentTermsTemplateId ?? defaults.input.paymentTermsTemplateId,
      sendWelcome: a.sendWelcome ?? defaults.input.sendWelcome,
    };
    // Mark first, so a partial approval can still be found and reversed.
    await db.application.updateMany({ where: { shop, id: applicationId }, data: { autoRuleId: rule.id } });
    const state = await approveApplication(ctx, applicationId, input);
    const failed = APPROVAL_STEPS.find((s) => state.steps[s]?.status === "failed");
    await logActivity({
      shop, actor: ACTOR, action: "automation.approve", subject: applicationId,
      result: failed ? "failed" : "ok", detail: { ruleId: rule.id, ...(failed ? { step: failed } : {}) },
    });
    return failed ? { decided: null, ruleId: rule.id } : { decided: "approved", ruleId: rule.id };
  } catch (e) {
    await logActivity({ shop, actor: ACTOR, action: "automation.evaluate", subject: applicationId, result: "failed", detail: { error: errorCodeOf(e) } }).catch(() => undefined);
    return { decided: null };
  }
}

export type ReverseResult = "undone" | "paused" | "reopened";

/**
 * Reverse an automatic decision:
 * - partial auto-approval → Undo (removes only what it created in Shopify), back to pending;
 * - finished auto-approval → the buyer is paused (taken out of the tier, sees retail
 *   prices); the company stays in Shopify because it may already have orders;
 * - auto-rejection → back to pending (an email already sent can't be recalled).
 */
export async function reverseAutoDecision(ctx: ApprovalCtx, applicationId: string): Promise<ReverseResult | null> {
  const app = await db.application.findFirst({ where: { shop: ctx.shop, id: applicationId, autoRuleId: { not: null } } });
  if (!app) return null;
  const ruleId = app.autoRuleId;
  try {
    let result: ReverseResult;
    const finished = app.status === "approved" && app.buyerId;
    if (finished) {
      const res = await pauseBuyers(ctx, [app.buyerId!]);
      if (res.failed.length) throw new Error(`pause_failed:${res.failed[0].code}`);
      result = "paused";
    } else {
      if (app.approvalState) await undoApproval(ctx, applicationId);
      await db.application.updateMany({ where: { shop: ctx.shop, id: applicationId }, data: { status: "pending", decidedAt: null } });
      result = app.status === "rejected" ? "reopened" : "undone";
    }
    // Cleared so the application leaves the "automatic decisions" list and can be decided again.
    await db.application.updateMany({ where: { shop: ctx.shop, id: applicationId }, data: { autoRuleId: null } });
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "automation.reverse", subject: applicationId, detail: { ruleId, was: app.status, result } });
    return result;
  } catch (e) {
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "automation.reverse", subject: applicationId, result: "failed", detail: { ruleId, error: errorCodeOf(e) } }).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Rule storage for the Automation page.


export async function listRules(shop: string): Promise<(RuleDef & { id: string })[]> {
  const rows = await db.rule.findMany({ where: { shop }, orderBy: [{ kind: "asc" }, { position: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as RuleDef["kind"],
    enabled: r.enabled,
    conditions: r.conditions as RuleConditions,
    action: r.action as RuleDef["action"],
    position: r.position,
  }));
}

/** Replace the shop's rules with the editor's list (positions follow list order per kind). */
export async function saveRules(shop: string, actor: string, rules: RuleDef[]): Promise<void> {
  const keep = rules.slice(0, MAX_RULES);
  const pos = { approve: 0, reject: 0 };
  await db.$transaction(async (tx) => {
    const existing = await tx.rule.findMany({ where: { shop }, select: { id: true } });
    const ids = new Set(existing.map((r) => r.id));
    const kept = new Set<string>();
    for (const r of keep) {
      const data = { kind: r.kind, enabled: r.enabled, conditions: r.conditions as object, action: r.action as object, position: pos[r.kind]++ };
      if (r.id && ids.has(r.id)) {
        await tx.rule.update({ where: { id: r.id }, data });
        kept.add(r.id);
      } else {
        await tx.rule.create({ data: { shop, ...data } });
      }
    }
    await tx.rule.deleteMany({ where: { shop, id: { in: [...ids].filter((id) => !kept.has(id)) } } });
  });
  await logActivity({ shop, actor, action: "automation.rules_saved", detail: { count: keep.length } });
}
