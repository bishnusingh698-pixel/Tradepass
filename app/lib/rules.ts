// Automation rule types and matching (pure, shared by the server and the
// Automation page). Server side: rules.server.ts.

export type Condition =
  | { type: "country"; op: "is" | "is_not"; values: string[] }
  | { type: "business_type"; op: "is" | "is_not"; values: string[] }
  | { type: "email_domain"; op: "is" | "is_not"; values: string[] }
  | { type: "tax_verified" }
  | { type: "certificate_uploaded" }
  | { type: "custom_field"; field: string; value: string }
  | { type: "spam" };

export const CONDITION_TYPES = ["country", "business_type", "email_domain", "tax_verified", "certificate_uploaded", "custom_field", "spam"] as const;

export type RuleConditions = { match: "all" | "any"; list: Condition[] };
export type ApproveAction = { tierId: string; paymentTermsTemplateId: string | null; sendWelcome: boolean };
/** The reason is stored on the application, so the merchant can copy the "not approved" message from it. */
export type RejectAction = { reason: string | null };

export type RuleDef = {
  id?: string;
  kind: "approve" | "reject";
  enabled: boolean;
  conditions: RuleConditions;
  action: ApproveAction | RejectAction;
  position: number;
};

/** What a rule can see about an application (ids and codes, plus the email domain only). */
export type ApplicationFacts = {
  country: string | null;
  businessType: string | null;
  emailDomain: string;
  taxVerified: boolean;
  hasCertificate: boolean;
  flags: string[];
  answers: Record<string, unknown>;
};

const norm = (s: string) => s.trim().toLowerCase();
export const domainOf = (email: string) => norm(email.split("@").pop() ?? "");

function inList(value: string | null, values: string[]): boolean {
  if (!value) return false;
  const v = norm(value);
  return values.some((x) => norm(x).replace(/^@/, "") === v);
}

export function matchCondition(c: Condition, f: ApplicationFacts): boolean {
  switch (c.type) {
    case "country":
      return c.op === "is" ? inList(f.country, c.values) : !inList(f.country, c.values);
    case "business_type":
      return c.op === "is" ? inList(f.businessType, c.values) : !inList(f.businessType, c.values);
    case "email_domain":
      return c.op === "is" ? inList(f.emailDomain, c.values) : !inList(f.emailDomain, c.values);
    case "tax_verified":
      return f.taxVerified;
    case "certificate_uploaded":
      return f.hasCertificate;
    case "spam":
      return f.flags.includes("possible_spam");
    case "custom_field": {
      const a = f.answers[c.field];
      const want = norm(c.value);
      if (Array.isArray(a)) return a.some((x) => norm(String(x)) === want);
      return a !== undefined && a !== null && norm(String(a)) === want;
    }
    default:
      return false;
  }
}

/** A rule with no conditions never matches (an empty rule must not approve everyone). */
export function matchRule(rule: Pick<RuleDef, "enabled" | "conditions">, f: ApplicationFacts): boolean {
  const list = rule.conditions?.list ?? [];
  if (!rule.enabled || !list.length) return false;
  return rule.conditions.match === "any" ? list.some((c) => matchCondition(c, f)) : list.every((c) => matchCondition(c, f));
}

/** First matching rule: reject rules before approve rules, each by position. */
export function pickRule<R extends Pick<RuleDef, "enabled" | "conditions" | "kind" | "position">>(rules: R[], f: ApplicationFacts): R | null {
  const ordered = [...rules].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === "reject" ? -1 : 1));
  return ordered.find((r) => matchRule(r, f)) ?? null;
}

export type RuleProblem = { index: number; field: "conditions" | "tier" | "values" | "field"; code: string };

/** Validate rules from the editor; returns problems keyed by rule index (shown next to the field). */
export function validateRules(rules: RuleDef[], tierIds: string[]): RuleProblem[] {
  const out: RuleProblem[] = [];
  rules.forEach((r, index) => {
    if (!r.conditions?.list?.length) out.push({ index, field: "conditions", code: "conditions_required" });
    for (const c of r.conditions?.list ?? []) {
      if ((c.type === "country" || c.type === "business_type" || c.type === "email_domain") && !c.values.filter((v) => v.trim()).length) {
        out.push({ index, field: "values", code: "values_required" });
      }
      if (c.type === "custom_field" && (!c.field.trim() || !c.value.trim())) out.push({ index, field: "field", code: "field_required" });
    }
    if (r.kind === "approve" && !tierIds.includes((r.action as ApproveAction).tierId)) out.push({ index, field: "tier", code: "tier_required" });
  });
  return out;
}


/** Error codes only: approval messages are translated sentences that may name the company. */
export function errorCodeOf(e: unknown): string {
  const x = e as { code?: string; step?: string; name?: string; message?: string };
  if (x.code) return String(x.code).slice(0, 60);
  if (x.step) return `step:${x.step}`;
  return x.name && x.name !== "Error" ? x.name : String(x.message ?? "error").split(":")[0].slice(0, 60);
}

export const MAX_RULES = 50;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown, max = 100) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 255)).filter(Boolean).slice(0, max) : []);

function sanitizeCondition(raw: unknown): Condition | null {
  if (!isObj(raw)) return null;
  const op = raw.op === "is_not" ? "is_not" : "is";
  switch (raw.type) {
    case "country":
      return { type: "country", op, values: strings(raw.values, 250).map((v) => v.toUpperCase()).filter((v) => /^[A-Z]{2}$/.test(v)) };
    case "business_type":
    case "email_domain":
      return { type: raw.type, op, values: strings(raw.values) };
    case "tax_verified":
    case "certificate_uploaded":
    case "spam":
      return { type: raw.type };
    case "custom_field":
      return { type: "custom_field", field: typeof raw.field === "string" ? raw.field.trim().slice(0, 100) : "", value: typeof raw.value === "string" ? raw.value.trim().slice(0, 255) : "" };
    default:
      return null;
  }
}

/**
 * Rebuild rules from what the Automation page posted: only known kinds, condition
 * types and action fields survive (validateRules then reports what's missing).
 */
export function sanitizeRules(raw: unknown): RuleDef[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleDef[] = [];
  for (const r of raw.slice(0, MAX_RULES)) {
    if (!isObj(r) || (r.kind !== "approve" && r.kind !== "reject")) continue;
    const c = isObj(r.conditions) ? r.conditions : {};
    const list = (Array.isArray(c.list) ? c.list : []).slice(0, 20).map(sanitizeCondition).filter((x): x is Condition => x !== null);
    const a = isObj(r.action) ? r.action : {};
    const action: ApproveAction | RejectAction = r.kind === "approve"
      ? {
          tierId: typeof a.tierId === "string" ? a.tierId.slice(0, 100) : "",
          paymentTermsTemplateId: typeof a.paymentTermsTemplateId === "string" && /^gid:\/\/shopify\/PaymentTermsTemplate\/\d+$/.test(a.paymentTermsTemplateId) ? a.paymentTermsTemplateId : null,
          sendWelcome: a.sendWelcome !== false,
        }
      : { reason: typeof a.reason === "string" && a.reason.trim() ? a.reason.trim().slice(0, 2000) : null };
    out.push({
      ...(typeof r.id === "string" && r.id.length <= 40 ? { id: r.id } : {}),
      kind: r.kind,
      enabled: r.enabled !== false,
      conditions: { match: c.match === "any" ? "any" : "all", list },
      action,
      position: out.length,
    });
  }
  return out;
}

