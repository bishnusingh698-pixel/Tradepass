import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useBlocker, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { updateSettings } from "../lib/settings.server";
import { paymentTermsOptions } from "../lib/tiers.server";
import { autoApprovalsToday, listRules, MAX_RULES, reverseAutoDecision, saveRules } from "../lib/rules.server";
import { CONDITION_TYPES, validateRules, type Condition, type RuleDef, type RuleProblem, type ApproveAction, type RejectAction } from "../lib/rules";
import { TRIGGER_HANDLES, type FlowTrigger } from "../lib/flow.server";
import { can } from "../lib/plans";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

const flag = (name: string, on: boolean | undefined) => (on ? { [name]: true } : {});
const MAX_DAILY_LIMIT = 500;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const rulesOn = can(ctx.plan, "auto_rules");
  const [rules, tiers, terms, today, recent] = await Promise.all([
    listRules(ctx.shop),
    db.tier.findMany({ where: { shop: ctx.shop }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    rulesOn ? paymentTermsOptions(ctx.admin) : Promise.resolve([]),
    autoApprovalsToday(ctx.shop),
    db.application.findMany({
      where: { shop: ctx.shop, autoRuleId: { not: null } },
      orderBy: { decidedAt: "desc" },
      take: 20,
      select: { id: true, companyName: true, status: true, decidedAt: true },
    }),
  ]);
  return {
    rules,
    tiers,
    terms: terms.map((p) => ({ id: p.id, name: p.name })),
    automation: ctx.settings.automation,
    today,
    recent: recent.map((r) => ({ ...r, decidedAt: r.decidedAt?.toISOString() ?? null })),
    rulesOn,
    flowOn: can(ctx.plan, "flow"),
    triggers: Object.keys(TRIGGER_HANDLES) as FlowTrigger[],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "reverse") {
    try {
      const result = await reverseAutoDecision({ admin: ctx.admin, shop: ctx.shop, actor: ctx.actor, t: ctx.t }, String(form.get("id")));
      return { ok: Boolean(result), intent, result };
    } catch {
      return { ok: false, intent };
    }
  }

  if (intent === "save") {
    if (!can(ctx.plan, "auto_rules")) return { ok: false, intent, problems: [] as RuleProblem[], limitError: false };
    const rules = JSON.parse(String(form.get("rules") ?? "[]")) as RuleDef[];
    const dailyLimit = Number(form.get("dailyLimit"));
    const tiers = await db.tier.findMany({ where: { shop: ctx.shop }, select: { id: true } });
    const problems = validateRules(rules, tiers.map((t) => t.id));
    const limitError = !Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > MAX_DAILY_LIMIT;
    if (problems.length || limitError) return { ok: false, intent, problems, limitError };
    await saveRules(ctx.shop, ctx.actor, rules.slice(0, MAX_RULES));
    await updateSettings(ctx.shop, { automation: { paused: form.get("paused") === "true", dailyLimit } });
    return { ok: true, intent, problems: [] as RuleProblem[], limitError: false };
  }
  return { ok: false, intent };
};

type Draft = { rules: RuleDef[]; paused: boolean; dailyLimit: string };

const newCondition = (type: Condition["type"]): Condition => {
  switch (type) {
    case "country":
    case "business_type":
    case "email_domain":
      return { type, op: "is", values: [] };
    case "custom_field":
      return { type, field: "", value: "" };
    default:
      return { type } as Condition;
  }
};

export default function Automation() {
  const d = useLoaderData<typeof loader>();
  const { t, i18n } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const save = useFetcher<typeof action>();
  const other = useFetcher<typeof action>();

  const initial = (): Draft => ({ rules: d.rules, paused: d.automation.paused, dailyLimit: String(d.automation.dailyLimit) });
  const [draft, setDraft] = useState<Draft>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial()));
  const [submitted, setSubmitted] = useState(false);
  const dirty = JSON.stringify(draft) !== baseline;
  const busy = save.state !== "idle";
  const locked = !d.rulesOn;

  const problems: RuleProblem[] = submitted && save.data && "problems" in save.data ? save.data.problems ?? [] : [];
  const limitError = submitted && save.data && "limitError" in save.data && save.data.limitError;
  const problemFor = (index: number, field: RuleProblem["field"]) => {
    const p = problems.find((x) => x.index === index && x.field === field);
    return p ? t(`automation.error.${p.code}`) : undefined;
  };

  useEffect(() => {
    if (save.state !== "idle" || !save.data) return;
    if (save.data.ok) {
      setBaseline(JSON.stringify(draft));
      setSubmitted(false);
      shopify.toast.show(t("common.saved"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the save result only
  }, [save.state, save.data]);

  useEffect(() => {
    if (other.state !== "idle" || !other.data || other.data.intent !== "reverse") return;
    const result = "result" in other.data ? other.data.result : null;
    shopify.toast.show(other.data.ok && result ? t(`automation.recent.reversed.${result}`) : t("automation.recent.reverseFailed"), { isError: !other.data.ok });
  }, [other.state, other.data, shopify, t]);

  // Block in-app navigation while unsaved; App Bridge asks to save or discard.
  const leaving = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const to = blocker.location;
    blocker.reset();
    void shopify.saveBar.leaveConfirmation().then(() => {
      leaving.current = true;
      navigate(to.pathname + to.search);
    });
  }, [blocker, navigate, shopify]);

  const onSave = () => {
    setSubmitted(true);
    save.submit({ intent: "save", rules: JSON.stringify(draft.rules), paused: String(draft.paused), dailyLimit: draft.dailyLimit }, { method: "POST" });
  };
  const onDiscard = () => {
    setDraft(JSON.parse(baseline) as Draft);
    setSubmitted(false);
  };

  const setRule = (i: number, patch: Partial<RuleDef>) =>
    setDraft((s) => ({ ...s, rules: s.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setCondition = (i: number, ci: number, c: Condition) =>
    setRule(i, { conditions: { ...draft.rules[i].conditions, list: draft.rules[i].conditions.list.map((x, k) => (k === ci ? c : x)) } });
  const addRule = (kind: RuleDef["kind"]) =>
    setDraft((s) => ({
      ...s,
      rules: [
        ...s.rules,
        {
          kind,
          enabled: true,
          position: s.rules.length,
          conditions: { match: "all", list: [newCondition(kind === "reject" ? "spam" : "country")] },
          action: kind === "approve" ? { tierId: d.tiers[0]?.id ?? "", paymentTermsTemplateId: null, sendWelcome: true } : { reason: null, email: false },
        },
      ],
    }));

  const ruleName = (r: RuleDef, i: number) => t(r.kind === "approve" ? "automation.rule.approveTitle" : "automation.rule.rejectTitle", { number: i + 1 });

  return (
    <s-page heading={t("automation.title")}>
      <SaveBar id="automation-save-bar" open={dirty || busy} discardConfirmation>
        <button variant="primary" onClick={onSave} {...flag("loading", busy)} {...flag("disabled", busy)}>{t("common.save")}</button>
        <button onClick={onDiscard} {...flag("disabled", busy)}>{t("common.discard")}</button>
      </SaveBar>

      {submitted && problems.length > 0 && (
        <s-banner tone="critical" heading={t("automation.error.summary", { count: problems.length })}>
          <s-unordered-list>
            {problems.map((p, k) => (
              <s-list-item key={k}>
                <s-link href={`#rule-${p.index}`}>{`${ruleName(draft.rules[p.index], p.index)}: ${t(`automation.error.${p.code}`)}`}</s-link>
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section heading={t("automation.settings.heading")}>
        <s-stack direction="block" gap="base">
          {locked && <s-badge tone="info">{t("common.availableOn", { plan: "Pro" })}</s-badge>}
          <s-switch
            label={t("automation.settings.paused")}
            details={t("automation.settings.pausedHelp")}
            checked={draft.paused}
            {...flag("disabled", locked)}
            onChange={(e) => setDraft((s) => ({ ...s, paused: e.currentTarget.checked }))}
          />
          <s-number-field
            label={t("automation.settings.dailyLimit")}
            details={t("automation.settings.dailyLimitHelp", { count: d.today })}
            value={draft.dailyLimit}
            min={0}
            max={MAX_DAILY_LIMIT}
            error={limitError ? t("automation.error.dailyLimit", { max: MAX_DAILY_LIMIT }) : undefined}
            {...flag("disabled", locked)}
            onInput={(e) => setDraft((s) => ({ ...s, dailyLimit: e.currentTarget.value }))}
          />
        </s-stack>
      </s-section>

      <s-section heading={t("automation.rules.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("automation.rules.body")}</s-paragraph>
          {locked && <s-badge tone="info">{t("common.availableOn", { plan: "Pro" })}</s-badge>}
          {!d.tiers.length && !locked && <s-banner tone="warning">{t("automation.rules.noTiers")}</s-banner>}
          {draft.rules.length === 0 && (
            <s-stack direction="block" gap="small" alignItems="center">
              <s-heading>{t("automation.empty.heading")}</s-heading>
              <s-paragraph>{t("automation.empty.body")}</s-paragraph>
            </s-stack>
          )}
          {draft.rules.map((r, i) => (
            <s-box key={i} id={`rule-${i}`} padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
                  <s-heading>{ruleName(r, i)}</s-heading>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-switch label={t("automation.rule.enabled")} checked={r.enabled} {...flag("disabled", locked)} onChange={(e) => setRule(i, { enabled: e.currentTarget.checked })} />
                    <s-button variant="tertiary" tone="critical" {...flag("disabled", locked)} accessibilityLabel={t("automation.rule.removeLabel", { rule: ruleName(r, i) })} onClick={() => setDraft((s) => ({ ...s, rules: s.rules.filter((_, j) => j !== i) }))}>
                      {t("automation.rule.remove")}
                    </s-button>
                  </s-stack>
                </s-stack>

                <s-select label={t("automation.rule.match")} value={r.conditions.match} {...flag("disabled", locked)} onChange={(e) => setRule(i, { conditions: { ...r.conditions, match: e.currentTarget.value as "all" | "any" } })}>
                  <s-option value="all">{t("automation.rule.matchAll")}</s-option>
                  <s-option value="any">{t("automation.rule.matchAny")}</s-option>
                </s-select>

                {problemFor(i, "conditions") && <s-text tone="critical">{problemFor(i, "conditions")}</s-text>}
                {r.conditions.list.map((c, ci) => (
                  <ConditionRow
                    key={ci}
                    c={c}
                    disabled={locked}
                    error={problemFor(i, c.type === "custom_field" ? "field" : "values")}
                    onChange={(next) => setCondition(i, ci, next)}
                    onRemove={() => setRule(i, { conditions: { ...r.conditions, list: r.conditions.list.filter((_, k) => k !== ci) } })}
                  />
                ))}
                <s-button variant="secondary" {...flag("disabled", locked)} onClick={() => setRule(i, { conditions: { ...r.conditions, list: [...r.conditions.list, newCondition("country")] } })}>
                  {t("automation.rule.addCondition")}
                </s-button>

                <s-divider />
                {r.kind === "approve" ? (
                  <ApproveFields action={r.action as ApproveAction} tiers={d.tiers} terms={d.terms} disabled={locked} tierError={problemFor(i, "tier")} onChange={(action) => setRule(i, { action })} />
                ) : (
                  <RejectFields action={r.action as RejectAction} disabled={locked} onChange={(action) => setRule(i, { action })} />
                )}
              </s-stack>
            </s-box>
          ))}
          <s-stack direction="inline" gap="base">
            <s-button {...flag("disabled", locked || draft.rules.length >= MAX_RULES)} onClick={() => addRule("approve")}>{t("automation.rules.addApprove")}</s-button>
            <s-button {...flag("disabled", locked || draft.rules.length >= MAX_RULES)} onClick={() => addRule("reject")}>{t("automation.rules.addReject")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("automation.recent.heading")}>
        {d.recent.length === 0 ? (
          <s-paragraph>{t("automation.recent.none")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("automation.recent.company")}</s-table-header>
              <s-table-header>{t("automation.recent.decision")}</s-table-header>
              <s-table-header>{t("automation.recent.when")}</s-table-header>
              <s-table-header>{t("automation.recent.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.recent.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell><s-link href={href(`/app/applications/${a.id}`)}>{a.companyName}</s-link></s-table-cell>
                  <s-table-cell>
                    <s-badge tone={a.status === "approved" ? "success" : a.status === "rejected" ? "neutral" : "info"}>{t(`automation.recent.status.${a.status === "approved" || a.status === "rejected" ? a.status : "other"}`)}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{a.decidedAt ? i18n.date(new Date(a.decidedAt), { dateStyle: "medium", timeStyle: "short" }) : "—"}</s-table-cell>
                  <s-table-cell>
                    {(a.status === "approved" || a.status === "rejected") && (
                      <s-button variant="tertiary" commandFor={`reverse-${a.id}`} command="--show">{t("automation.recent.reverse")}</s-button>
                    )}
                    <s-modal id={`reverse-${a.id}`} heading={t("automation.reverse.heading", { company: a.companyName })}>
                      <s-paragraph>{t(a.status === "approved" ? "automation.reverse.approvedBody" : "automation.reverse.rejectedBody", { company: a.companyName })}</s-paragraph>
                      <s-button slot="primary-action" variant="primary" tone="critical" commandFor={`reverse-${a.id}`} command="--hide" onClick={() => other.submit({ intent: "reverse", id: a.id }, { method: "POST" })}>
                        {t("automation.reverse.confirm")}
                      </s-button>
                      <s-button slot="secondary-actions" commandFor={`reverse-${a.id}`} command="--hide">{t("common.cancel")}</s-button>
                    </s-modal>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("automation.flow.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("automation.flow.body")}</s-paragraph>
          {!d.flowOn && <s-badge tone="info">{t("common.availableOn", { plan: "Pro" })}</s-badge>}
          <s-heading>{t("automation.flow.triggers")}</s-heading>
          <s-unordered-list>
            {d.triggers.map((tr) => (
              <s-list-item key={tr}>{t(`automation.flow.trigger.${tr}`)}</s-list-item>
            ))}
          </s-unordered-list>
          <s-heading>{t("automation.flow.actions")}</s-heading>
          <s-unordered-list>
            <s-list-item>{t("automation.flow.action.approve")}</s-list-item>
          </s-unordered-list>
          <s-paragraph color="subdued">{t("automation.flow.welcomeNote")}</s-paragraph>
          <s-button href="shopify://admin/apps/flow" target="_top" {...flag("disabled", !d.flowOn)}>{t("automation.flow.open")}</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function ConditionRow({ c, disabled, error, onChange, onRemove }: { c: Condition; disabled: boolean; error?: string; onChange: (c: Condition) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const listValue = "values" in c ? c.values.join(", ") : "";
  return (
    <s-stack direction="inline" gap="small" alignItems="end">
      <s-select label={t("automation.condition.type")} value={c.type} {...flag("disabled", disabled)} onChange={(e) => onChange(newCondition(e.currentTarget.value as Condition["type"]))}>
        {CONDITION_TYPES.map((ty) => (
          <s-option key={ty} value={ty}>{t(`automation.condition.${ty}`)}</s-option>
        ))}
      </s-select>
      {"op" in c && (
        <>
          <s-select label={t("automation.condition.op")} value={c.op} {...flag("disabled", disabled)} onChange={(e) => onChange({ ...c, op: e.currentTarget.value as "is" | "is_not" })}>
            <s-option value="is">{t("automation.condition.is")}</s-option>
            <s-option value="is_not">{t("automation.condition.isNot")}</s-option>
          </s-select>
          <s-text-field
            label={t(`automation.condition.values.${c.type}`)}
            details={t("automation.condition.valuesHelp")}
            value={listValue}
            error={error}
            {...flag("disabled", disabled)}
            onInput={(e) => onChange({ ...c, values: e.currentTarget.value.split(",").map((v) => v.trim()) })}
          />
        </>
      )}
      {c.type === "custom_field" && (
        <>
          <s-text-field label={t("automation.condition.field")} details={t("automation.condition.fieldHelp")} value={c.field} error={error} {...flag("disabled", disabled)} onInput={(e) => onChange({ ...c, field: e.currentTarget.value })} />
          <s-text-field label={t("automation.condition.equals")} value={c.value} {...flag("disabled", disabled)} onInput={(e) => onChange({ ...c, value: e.currentTarget.value })} />
        </>
      )}
      <s-button variant="tertiary" {...flag("disabled", disabled)} accessibilityLabel={t("automation.condition.removeLabel")} onClick={onRemove}>
        {t("automation.condition.remove")}
      </s-button>
    </s-stack>
  );
}

function ApproveFields({ action, tiers, terms, disabled, tierError, onChange }: {
  action: ApproveAction; tiers: { id: string; name: string }[]; terms: { id: string; name: string }[]; disabled: boolean; tierError?: string; onChange: (a: ApproveAction) => void;
}) {
  const { t } = useI18n();
  return (
    <s-stack direction="block" gap="small">
      <s-select label={t("automation.action.tier")} value={action.tierId} error={tierError} {...flag("disabled", disabled)} onChange={(e) => onChange({ ...action, tierId: e.currentTarget.value })}>
        <s-option value="">{t("automation.action.chooseTier")}</s-option>
        {tiers.map((tier) => <s-option key={tier.id} value={tier.id}>{tier.name}</s-option>)}
      </s-select>
      <s-select label={t("automation.action.terms")} value={action.paymentTermsTemplateId ?? ""} {...flag("disabled", disabled)} onChange={(e) => onChange({ ...action, paymentTermsTemplateId: e.currentTarget.value || null })}>
        <s-option value="">{t("automation.action.tierTerms")}</s-option>
        {terms.map((p) => <s-option key={p.id} value={p.id}>{p.name}</s-option>)}
      </s-select>
      <s-checkbox label={t("automation.action.sendWelcome")} checked={action.sendWelcome} {...flag("disabled", disabled)} onChange={(e) => onChange({ ...action, sendWelcome: e.currentTarget.checked })} />
    </s-stack>
  );
}

function RejectFields({ action, disabled, onChange }: { action: RejectAction; disabled: boolean; onChange: (a: RejectAction) => void }) {
  const { t } = useI18n();
  return (
    <s-stack direction="block" gap="small">
      <s-checkbox label={t("automation.action.emailApplicant")} checked={action.email} {...flag("disabled", disabled)} onChange={(e) => onChange({ ...action, email: e.currentTarget.checked })} />
      {action.email && (
        <s-text-area label={t("automation.action.reason")} details={t("automation.action.reasonHelp")} value={action.reason ?? ""} {...flag("disabled", disabled)} onInput={(e) => onChange({ ...action, reason: e.currentTarget.value || null })} />
      )}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
