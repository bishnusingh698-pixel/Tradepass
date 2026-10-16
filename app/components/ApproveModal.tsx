/**
 * Approve modal (spec §F "Approve").
 *
 * Props:
 *   applicationId: string  — the application to approve
 *   companyName:   string  — shown in the heading "Approve {company}"
 *
 * Renders `<s-modal id="approve-modal">`. Open it from the page with
 *   <s-button variant="primary" commandFor="approve-modal" command="--show">…</s-button>
 * or call `openApproveModal()`. Defaults load from
 * /app/applications/<id>/approve when the modal is shown. While an approval
 * runs, the step list (Company → Location → Contact → Terms & tax → Tier →
 * Email) updates live; a failed step shows Retry / Undo. After a successful
 * approval the page's loaders are revalidated.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "./useLocaleHref";
import type { Address, ApprovalDefaults, ApprovalState, ApprovalStep, ApproveInput } from "../lib/approval.server";

export const APPROVE_MODAL_ID = "approve-modal";

export function openApproveModal() {
  (document.getElementById(APPROVE_MODAL_ID) as (HTMLElement & { showOverlay?: () => void }) | null)?.showOverlay?.();
}

const STEPS: ApprovalStep[] = ["company", "location", "contact", "terms_tax", "tier", "email"];

type LoaderData = { defaults?: ApprovalDefaults; error?: string; message?: string; progress?: ApprovalState | null; status?: string | null };
type ActionData = { ok: boolean; state?: ApprovalState | null; undone?: boolean; error?: string; message?: string };

const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;

export function ApproveModal({ applicationId, companyName }: { applicationId: string; companyName: string }) {
  const { t } = useI18n();
  const exemptionLabel = useExemptionLabel();
  const href = useLocaleHref();
  const url = href(`/app/applications/${applicationId}/approve`);
  const progressUrl = href(`/app/applications/${applicationId}/approve?progress=1`);
  const load = useFetcher<LoaderData>();
  const poll = useFetcher<LoaderData>();
  const act = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const [input, setInput] = useState<ApproveInput | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [sameShipping, setSameShipping] = useState(true);
  const [addExemption, setAddExemption] = useState("");
  const loadedOnce = useRef(false);

  const defaults = load.data?.defaults;
  if (defaults && !input) {
    setInput(defaults.input);
    setSameShipping(!defaults.input.shippingAddress);
  }

  const onShow = () => {
    if (!loadedOnce.current || !defaults) {
      loadedOnce.current = true;
      load.load(url);
    }
  };

  // Live progress while the approve/retry request is in flight (stops as soon as it returns).
  const busy = act.state !== "idle";
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => poll.load(progressUrl), 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, progressUrl]);

  const actState = act.data && "state" in act.data ? act.data.state : undefined;
  const state: ApprovalState | null =
    busy ? (poll.data?.progress as ApprovalState | null) ?? defaults?.state ?? null : actState !== undefined ? actState ?? null : defaults?.state ?? null;

  const success = Boolean(act.data?.ok && actState && !STEPS.some((s) => actState.steps[s].status === "failed" && s !== "email") && actState.buyerId);
  useEffect(() => {
    if (act.state === "idle" && act.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act.state, act.data]);

  const errors = useMemo(() => (input ? validate(input, sameShipping) : {}), [input, sameShipping]);
  const showErr = (k: string) => ((touched[k] || submitted) && errors[k] ? t(errors[k]) : undefined);
  const touch = (k: string) => setTouched((x) => ({ ...x, [k]: true }));
  const set = (patch: Partial<ApproveInput>) => setInput((x) => (x ? { ...x, ...patch } : x));
  const setAddr = (which: "billingAddress" | "shippingAddress", patch: Partial<Address>) =>
    setInput((x) => (x ? { ...x, [which]: { ...((x[which] ?? { address1: "", city: "", countryCode: "" }) as Address), ...patch } } : x));

  const submit = (intent: "approve" | "retry" | "undo") => {
    const fd = new FormData();
    fd.set("intent", intent);
    if (intent === "approve" && input) {
      setSubmitted(true);
      if (Object.keys(errors).length) return;
      fd.set("input", JSON.stringify({ ...input, shippingAddress: sameShipping ? null : input.shippingAddress }));
    }
    act.submit(fd, { method: "POST", action: url });
  };

  const heading = t("approval.modal.heading", { company: companyName });
  const showProgress = Boolean(state && (busy || STEPS.some((s) => state.steps[s].status !== "pending")));
  const failed = state ? STEPS.find((s) => state.steps[s].status === "failed") : undefined;
  const blockedMsg = load.data?.error ? load.data.message : act.data && !act.data.ok ? act.data.message : null;
  const quotaBlocked = Boolean(defaults?.quota.blocked && !state?.steps.company.gid);

  return (
    <s-modal id={APPROVE_MODAL_ID} heading={heading} size="large" onShow={onShow}>
      {blockedMsg && (
        <s-banner tone="critical">
          <s-paragraph>{blockedMsg}</s-paragraph>
          {(load.data?.error ?? act.data?.error) === "plan_limit" && (
            <s-button slot="secondary-actions" href={href("/app/plans")}>{t("approval.quota.upgrade")}</s-button>
          )}
        </s-banner>
      )}

      {!input && !load.data?.error && (
        <s-stack direction="block" gap="base" alignItems="center" padding="large">
          <s-spinner accessibilityLabel={t("approval.modal.loading")} />
        </s-stack>
      )}

      {input && defaults && showProgress && state && (
        <Progress state={state} busy={busy} success={success} />
      )}

      {input && defaults && !showProgress && (
        <s-stack direction="block" gap="base">
          {quotaBlocked && (
            <s-banner tone="warning" heading={t("approval.quota.heading")}>
              <s-paragraph>{t("approval.quota.body", { limit: defaults.quota.limit ?? 0 })}</s-paragraph>
              <s-button slot="secondary-actions" href={href("/app/plans")}>{t("approval.quota.upgrade")}</s-button>
            </s-banner>
          )}

          <s-section heading={t("approval.section.tier")}>
            <s-stack direction="block" gap="base">
              {defaults.tiers.length === 0 ? (
                <s-banner tone="warning">
                  <s-paragraph>{t("approval.tier.none")}</s-paragraph>
                  <s-button slot="secondary-actions" href={href("/app/tiers/new")}>{t("approval.tier.create")}</s-button>
                </s-banner>
              ) : (
                <s-select
                  label={t("approval.field.tier")}
                  required
                  value={input.tierId}
                  error={showErr("tierId")}
                  details={
                    defaults.catalogBudget.limit != null && defaults.catalogBudget.used != null
                      ? t("approval.tier.budget", { used: defaults.catalogBudget.used, limit: defaults.catalogBudget.limit })
                      : undefined
                  }
                  onChange={(e) => {
                    const id = val(e);
                    const td = defaults.tierDefaults[id];
                    touch("tierId");
                    set({ tierId: id, ...(td ? { paymentTermsTemplateId: td.paymentTermsTemplateId, checkoutToDraft: td.checkoutToDraft } : {}) });
                  }}
                >
                  {defaults.tiers.map((x) => (
                    <s-option key={x.id} value={x.id}>{x.name}</s-option>
                  ))}
                </s-select>
              )}
              <s-select
                label={t("approval.field.terms")}
                value={input.paymentTermsTemplateId ?? ""}
                onChange={(e) => set({ paymentTermsTemplateId: val(e) || null })}
              >
                <s-option value="">{t("approval.terms.none")}</s-option>
                {defaults.paymentTermsOptions.map((p) => (
                  <s-option key={p.id} value={p.id}>{p.name}</s-option>
                ))}
              </s-select>
              <s-checkbox
                label={t("approval.field.checkoutToDraft")}
                details={t("approval.field.checkoutToDraftHelp")}
                checked={Boolean(input.checkoutToDraft)}
                onChange={(e) => set({ checkoutToDraft: checked(e) })}
              />
            </s-stack>
          </s-section>

          <s-section heading={t("approval.section.tax")}>
            <s-stack direction="block" gap="base">
              <s-switch
                label={t("approval.field.taxExempt")}
                checked={input.taxExempt}
                details={
                  defaults.suggestedExemption.exemption
                    ? t("approval.tax.suggested", { exemption: exemptionLabel(defaults.suggestedExemption.exemption), reason: t(`approval.tax.reason.${defaults.suggestedExemption.reason}`) })
                    : t(`approval.tax.reason.${defaults.suggestedExemption.reason}`)
                }
                onChange={(e) => {
                  const on = checked(e);
                  set({ taxExempt: on, exemptions: on && !input.exemptions.length && defaults.suggestedExemption.exemption ? [defaults.suggestedExemption.exemption] : input.exemptions });
                }}
              />
              {input.taxExempt && (
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="small-200">
                    {input.exemptions.map((x) => (
                      <s-clickable-chip
                        key={x}
                        removable
                        accessibilityLabel={t("approval.tax.remove", { exemption: exemptionLabel(x) })}
                        onRemove={() => set({ exemptions: input.exemptions.filter((y) => y !== x) })}
                      >
                        {exemptionLabel(x)}
                      </s-clickable-chip>
                    ))}
                  </s-stack>
                  <s-select
                    label={t("approval.field.addExemption")}
                    value={addExemption}
                    error={showErr("exemptions")}
                    onChange={(e) => {
                      const v = val(e);
                      setAddExemption("");
                      touch("exemptions");
                      if (v && !input.exemptions.includes(v)) set({ exemptions: [...input.exemptions, v] });
                    }}
                  >
                    <s-option value="">{t("approval.tax.choose")}</s-option>
                    {defaults.allExemptions.map((x) => (
                      <s-option key={x} value={x}>{exemptionLabel(x)}</s-option>
                    ))}
                  </s-select>
                </s-stack>
              )}
              <s-text-field
                label={t("approval.field.taxRegistrationId")}
                value={input.taxRegistrationId ?? ""}
                onInput={(e) => set({ taxRegistrationId: val(e) || null })}
              />
            </s-stack>
          </s-section>

          <s-section heading={t("approval.section.company")}>
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
                <s-text-field
                  label={t("approval.field.companyName")}
                  required
                  value={input.companyName}
                  error={showErr("companyName")}
                  onInput={(e) => set({ companyName: val(e) })}
                  onBlur={() => touch("companyName")}
                />
                <s-text-field
                  label={t("approval.field.locationName")}
                  required
                  value={input.locationName}
                  error={showErr("locationName")}
                  onInput={(e) => set({ locationName: val(e) })}
                  onBlur={() => touch("locationName")}
                />
              </s-grid>
              <AddressFields
                legend={t("approval.field.billingAddress")}
                prefix="billing"
                value={input.billingAddress}
                onChange={(p) => setAddr("billingAddress", p)}
                showErr={showErr}
                touch={touch}
              />
              <s-checkbox label={t("approval.field.sameShipping")} checked={sameShipping} onChange={(e) => setSameShipping(checked(e))} />
              {!sameShipping && (
                <AddressFields
                  legend={t("approval.field.shippingAddress")}
                  prefix="shipping"
                  value={input.shippingAddress ?? { address1: "", city: "", countryCode: input.billingAddress.countryCode }}
                  onChange={(p) => setAddr("shippingAddress", p)}
                  showErr={showErr}
                  touch={touch}
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading={t("approval.section.contact")}>
            <s-stack direction="block" gap="base">
              {defaults.existingCustomer ? (
                <>
                  <s-select
                    label={t("approval.field.contact")}
                    value={input.contact.mode}
                    onChange={(e) =>
                      set({ contact: val(e) === "existing" ? { mode: "existing", customerGid: defaults.existingCustomer!.gid } : { mode: "new" } })
                    }
                  >
                    <s-option value="existing">
                      {t("approval.contact.existing", { name: defaults.existingCustomer.name, email: defaults.existingCustomer.email })}
                    </s-option>
                    <s-option value="new">{t("approval.contact.new")}</s-option>
                  </s-select>
                  {defaults.existingCustomer.otherCompany && (
                    <s-banner tone="warning">
                      <s-paragraph>{t("approval.contact.otherCompany", { company: defaults.existingCustomer.otherCompany })}</s-paragraph>
                    </s-banner>
                  )}
                </>
              ) : (
                <s-paragraph>{t("approval.contact.willCreate", { name: defaults.contactName || defaults.contactEmail, email: defaults.contactEmail })}</s-paragraph>
              )}
              <s-switch
                label={t("approval.field.sendWelcome")}
                details={t(defaults.useShopifyWelcome ? "approval.welcome.shopify" : "approval.welcome.ours")}
                checked={input.sendWelcome}
                onChange={(e) => set({ sendWelcome: checked(e) })}
              />
            </s-stack>
          </s-section>
        </s-stack>
      )}

      {/* Actions depend on the phase: form → Approve; failure → Retry / Undo; done → Close. */}
      {!showProgress && (
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={!input || quotaBlocked || !defaults?.tiers.length}
          onClick={() => submit("approve")}
        >
          {t("approval.action.approve")}
        </s-button>
      )}
      {showProgress && failed && failed !== "email" && !busy && (
        <s-button slot="primary-action" variant="primary" onClick={() => submit("retry")}>
          {t("approval.action.retry")}
        </s-button>
      )}
      {showProgress && failed === "email" && !busy && (
        <s-button slot="primary-action" variant="primary" onClick={() => submit("retry")}>
          {t("approval.action.retryEmail")}
        </s-button>
      )}
      {showProgress && failed && failed !== "email" && !busy && !state?.buyerId && (
        <s-button slot="secondary-actions" tone="critical" onClick={() => submit("undo")}>
          {t("approval.action.undo")}
        </s-button>
      )}
      <s-button slot="secondary-actions" commandFor={APPROVE_MODAL_ID} command="--hide" disabled={busy}>
        {showProgress && !failed && !busy ? t("approval.action.close") : t("common.cancel")}
      </s-button>
    </s-modal>
  );
}

function Progress({ state, busy, success }: { state: ApprovalState; busy: boolean; success: boolean }) {
  const { t } = useI18n();
  return (
    <s-stack direction="block" gap="base">
      {success && !busy && (
        <s-banner tone="success" heading={t("approval.progress.done")}>
          {state.steps.tier.pendingAssignment && <s-paragraph>{t("approval.progress.assisted")}</s-paragraph>}
        </s-banner>
      )}
      <s-stack direction="block" gap="small-200" accessibilityRole="status">
        {STEPS.map((s) => {
          const st = state.steps[s];
          const running = st.status === "running" || (busy && st.status === "pending" && STEPS.find((x) => state.steps[x].status === "pending") === s);
          return (
            <s-stack key={s} direction="block" gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {running ? (
                  <s-spinner size="base" accessibilityLabel={t("approval.progress.running")} />
                ) : (
                  <s-icon
                    type={st.status === "done" ? "check-circle" : st.status === "failed" ? "alert-circle" : st.status === "skipped" ? "circle" : "circle"}
                    tone={st.status === "done" ? "success" : st.status === "failed" ? "critical" : "neutral"}
                  />
                )}
                <s-text type={st.status === "failed" ? "strong" : undefined}>{t(`approval.step.${s}`)}</s-text>
                <s-text color="subdued">{t(`approval.status.${running ? "running" : st.status}`)}</s-text>
              </s-stack>
              {st.status === "failed" && st.error && (
                <s-text tone="critical">{st.error}</s-text>
              )}
            </s-stack>
          );
        })}
      </s-stack>
    </s-stack>
  );
}

function AddressFields({
  legend, prefix, value, onChange, showErr, touch,
}: {
  legend: string; prefix: string; value: Address; onChange: (p: Partial<Address>) => void;
  showErr: (k: string) => string | undefined; touch: (k: string) => void;
}) {
  const { t, locale } = useI18n();
  let countryName = "";
  try {
    countryName = value.countryCode?.length === 2 ? new Intl.DisplayNames([locale], { type: "region" }).of(value.countryCode.toUpperCase()) ?? "" : "";
  } catch {
    countryName = "";
  }
  return (
    <s-stack direction="block" gap="small-200">
      <s-heading>{legend}</s-heading>
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        <s-text-field label={t("approval.address.address1")} required value={value.address1} error={showErr(`${prefix}.address1`)}
          onInput={(e) => onChange({ address1: val(e) })} onBlur={() => touch(`${prefix}.address1`)} />
        <s-text-field label={t("approval.address.address2")} value={value.address2 ?? ""} onInput={(e) => onChange({ address2: val(e) })} />
        <s-text-field label={t("approval.address.city")} required value={value.city} error={showErr(`${prefix}.city`)}
          onInput={(e) => onChange({ city: val(e) })} onBlur={() => touch(`${prefix}.city`)} />
        <s-text-field label={t("approval.address.zone")} details={t("approval.address.zoneHelp")} value={value.zoneCode ?? ""}
          onInput={(e) => onChange({ zoneCode: val(e).toUpperCase() })} />
        <s-text-field label={t("approval.address.zip")} value={value.zip ?? ""} onInput={(e) => onChange({ zip: val(e) })} />
        <s-text-field label={t("approval.address.country")} required maxLength={2} details={countryName || t("approval.address.countryHelp")}
          value={value.countryCode} error={showErr(`${prefix}.countryCode`)}
          onInput={(e) => onChange({ countryCode: val(e).toUpperCase() })} onBlur={() => touch(`${prefix}.countryCode`)} />
      </s-grid>
    </s-stack>
  );
}

function validate(i: ApproveInput, sameShipping: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!i.tierId) e.tierId = "approval.error.field.tier";
  if (!i.companyName.trim()) e.companyName = "approval.error.field.required";
  if (!i.locationName.trim()) e.locationName = "approval.error.field.required";
  if (i.taxExempt && i.exemptions.length === 0) e.exemptions = "approval.error.field.exemption";
  const addr = (p: string, a: Address | null) => {
    if (!a?.address1?.trim()) e[`${p}.address1`] = "approval.error.field.required";
    if (!a?.city?.trim()) e[`${p}.city`] = "approval.error.field.required";
    if (!/^[A-Z]{2}$/.test(a?.countryCode ?? "")) e[`${p}.countryCode`] = "approval.error.field.country";
  };
  addr("billing", i.billingAddress);
  if (!sameShipping) addr("shipping", i.shippingAddress);
  return e;
}

/** US and EU exemptions get translated labels; Canadian ones keep Shopify's names (provincial programme names). */
function useExemptionLabel() {
  const { t } = useI18n();
  return (x: string) => {
    const us = /^US_([A-Z]{2})_RESELLER_EXEMPTION$/.exec(x);
    if (us) return t("approval.exemption.usReseller", { state: us[1] });
    if (x === "EU_REVERSE_CHARGE_EXEMPTION_RULE") return t("approval.exemption.euReverseCharge");
    return x.replace(/_EXEMPTION$/, "").replace(/_/g, " ");
  };
}
