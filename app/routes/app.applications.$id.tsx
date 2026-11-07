import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { addNote, approvedMessage, getApplication, queueNeighbours, rejectApplicationWithReason, rejectionMessage, requestMoreInfo, setAssignee } from "../lib/applications.server";
import { riskForApplication, waitingDays } from "../lib/applications";
import type { ApplicantMessage } from "../lib/messages";
import { defaultFormDefinition } from "../lib/form-defaults";
import { readDefinition } from "../lib/forms.server";
import { NOT_REQUESTABLE, requestableField } from "../lib/intake.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { CountryName, RelativeTime, StatusBadge, TaxCheckBadge } from "../components/applications";
import { ApproveModal } from "../components/ApproveModal";
import { MessageModal } from "../components/MessageModal";
import { openFromApp } from "../components/download";
import { PermitCheck } from "../components/PermitCheck";
import { can } from "../lib/plans";
import { replyIn } from "../lib/replies";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const found = await getApplication(ctx.shop, params.id!);
  if (!found) throw new Response("Not found", { status: 404 });
  const { app, taxNumber, files, certificates, activity, duplicates, buyer } = found;
  const form = app.formId ? await db.form.findFirst({ where: { shop: ctx.shop, id: app.formId } }) : null;
  const definition = form ? readDefinition(form.definition) : defaultFormDefinition();
  const locale = ctx.i18n.locale;
  const primary = ctx.shopRow?.primaryLocale ?? "en";
  const tier = buyer?.tierId ? await db.tier.findFirst({ where: { shop: ctx.shop, id: buyer.tierId }, select: { id: true, name: true } }) : null;
  const back = new URL(request.url).searchParams.get("back") ?? "tab=pending";
  const nav = await queueNeighbours(ctx.shop, back, app.id, ctx.actor);
  return {
    nav,
    risk: riskForApplication(app),
    attribution: (app.attribution ?? null) as Record<string, string> | null,
    me: ctx.actor,
    staleDays: ctx.settings.review.staleDays,
    isPlus: Boolean(ctx.shopRow?.isPlus),
    // Rejected: the "not approved" message stays available to copy (Tradepass sends no email).
    rejectionMessage: app.status === "rejected" ? await rejectionMessage(ctx.shop, app.id) : null,
    // Approved: the "you're approved" message, for when Shopify's B2B welcome email wasn't sent (D-092).
    approvedMessage: app.status === "approved" ? await approvedMessage(ctx.shop, app.id) : null,
    app: {
      id: app.id,
      status: app.status,
      companyName: app.companyName,
      email: app.email,
      countryCode: app.countryCode,
      businessType: app.businessType,
      locale: app.locale,
      answers: app.answers as Record<string, unknown>,
      taxCheck: app.taxCheck,
      taxCheckName: app.taxCheckName,
      flags: app.flags,
      assignee: app.assignee,
      notes: (Array.isArray(app.notes) ? app.notes : []) as { at: string; by: string; text: string }[],
      requested: app.requested as { fields: string[]; message: string; at: string } | null,
      rejectReason: app.rejectReason,
      submittedAt: app.submittedAt.toISOString(),
      decidedAt: app.decidedAt?.toISOString() ?? null,
      source: app.source,
      autoRuleId: app.autoRuleId,
      approvalState: app.approvalState as { steps?: Record<string, { status: string; error?: string }> } | null,
    },
    taxNumber,
    files: files.map((f) => ({ id: f.id, kind: f.kind, fileGid: f.fileGid, createdAt: f.createdAt.toISOString() })),
    certificates: certificates.map((c) => ({
      id: c.id, fileGid: c.fileGid, type: c.type, country: c.country, region: c.region, expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null, status: c.status,
      form: c.form, checkResult: c.checkResult, checkName: c.checkName, checkedBy: c.checkedBy, checkedAt: c.checkedAt?.toISOString() ?? null,
    })),
    liveChecks: can(ctx.plan, "tax_checks"),
    // Saved replies (B9): the name in the admin's language, the text in the applicant's language.
    replies: (["reject", "info"] as const).reduce((acc, kind) => ({
      ...acc,
      [kind]: ctx.settings.replies[kind].map((r) => ({ id: r.id, title: replyIn(r, locale, primary)?.title ?? "", text: replyIn(r, app.locale, primary)?.text ?? "" })),
    }), {} as Record<"reject" | "info", { id: string; title: string; text: string }[]>),
    activity: activity.map((a) => ({ id: a.id, actor: a.actor, action: a.action, result: a.result, at: a.createdAt.toISOString() })),
    duplicates: duplicates.map((d) => ({ ...d, submittedAt: d.submittedAt.toISOString() })),
    buyer: buyer ? { id: buyer.id, companyGid: buyer.companyGid, status: buyer.status } : null,
    tier,
    fields: definition.sections.flatMap((s) => s.fields.filter((f) => f.state !== "hidden").map((f) => ({
      id: f.id, custom: Boolean(f.custom), requestable: requestableField(f),
      // Custom questions: the label in the admin's language, else the store's primary language, else any.
      label: f.texts?.[locale]?.label ?? f.texts?.[locale.split("-")[0]]?.label ?? f.texts?.[primary]?.label ?? f.texts?.en?.label ?? Object.values(f.texts ?? {}).find((x) => x?.label)?.label ?? null,
    }))),
    shopHandle: ctx.shop.replace(".myshopify.com", ""),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const id = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const dctx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor };
  switch (intent) {
    case "reject": {
      const res = await rejectApplicationWithReason(dctx, id, { reason: String(form.get("reason") ?? "").trim() || null });
      if (res !== true) return { ok: false, intent, error: res };
      return { ok: true, intent, message: await rejectionMessage(ctx.shop, id) };
    }
    case "needs_info": {
      const message = String(form.get("message") ?? "").trim();
      const fields = [...new Set(form.getAll("fields").map(String))].filter((f) => !NOT_REQUESTABLE.has(f)).slice(0, 50);
      if (!message) return { ok: false, intent, error: "message_required" };
      if (!fields.length) return { ok: false, intent, error: "fields_required" };
      const res = await requestMoreInfo(dctx, id, { message, fields });
      return { ok: res.ok, intent, ...(res.error ? { error: res.error } : {}), ...(res.message ? { message: res.message } : {}) };
    }
    case "note": {
      const text = String(form.get("text") ?? "").trim();
      if (!text) return { ok: false, intent, error: "note_required" };
      await addNote(ctx.shop, id, ctx.actor, text);
      return { ok: true, intent };
    }
    case "assign": {
      await setAssignee(ctx.shop, id, String(form.get("assignee") ?? "").trim() || null);
      return { ok: true, intent };
    }
    case "assign_me": {
      // "Mine" in the queue matches the signed-in staff member's name (C13).
      await setAssignee(ctx.shop, id, ctx.actor);
      return { ok: true, intent: "assign" };
    }
  }
  return { ok: false, intent: "unknown" };
};

const STANDARD_SECTIONS: Record<string, string[]> = {
  business: ["companyName", "businessType", "website", "storeType", "storeUrl", "yearEstablished", "yearsInBusiness", "locationsCount", "monthlyOrderValue", "ein", "duns", "tradeReferences", "referral"],
  contact: ["firstName", "lastName", "email", "phone", "jobTitle", "preferredLanguage"],
};
const HANDLED = new Set([...STANDARD_SECTIONS.business, ...STANDARD_SECTIONS.contact, "billingAddress", "shippingAddress", "taxNumber", "certificates", "message", "consent", "taxNumberHash", "certificateMeta", "taxState", "taxCountry", "usPermits"]);

export default function ApplicationDetail() {
  const d = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const [params] = useSearchParams();
  const a = d.app;
  const open = a.status === "pending" || a.status === "needs_info";
  const backQuery = params.get("back") ?? "tab=pending";

  const label = (fieldId: string) => {
    const f = d.fields.find((x) => x.id === fieldId);
    if (f?.custom) return f.label ?? fieldId;
    const key = `applications.field.${fieldId}`;
    const s = t(key);
    return s === key ? fieldId : s;
  };
  const value = (v: unknown): string => {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.map(value).join(", ");
    if (typeof v === "boolean") return v ? t("applications.detail.yes") : t("applications.detail.no");
    if (typeof v === "object") return formatAddress(v as Record<string, string>, locale);
    return String(v);
  };
  const row = (fieldId: string) =>
    a.answers[fieldId] !== undefined || fieldId === "companyName" || fieldId === "email" ? (
      <s-stack key={fieldId} direction="block" gap="small-400">
        <s-text color="subdued">{label(fieldId)}</s-text>
        <s-text>{fieldId === "companyName" ? a.companyName : fieldId === "email" ? a.email : fieldId === "businessType" && a.businessType ? businessTypeLabel(t, a.businessType) : fieldId === "storeType" && typeof a.answers.storeType === "string" ? t(`form.option.storeType.${a.answers.storeType}`) : value(a.answers[fieldId])}</s-text>
      </s-stack>
    ) : null;

  const customAnswers = Object.keys(a.answers).filter((k) => !HANDLED.has(k));
  const shopify = useAppBridge();
  const openDocument = async (id: string) => {
    if (!(await openFromApp(`/app/files/${encodeURIComponent(id)}`))) shopify.toast.show(t("certificates.error.file"), { isError: true });
  };
  const failedStep = a.approvalState?.steps ? Object.entries(a.approvalState.steps).find(([, s]) => s.status === "failed") : null;
  const emailStep = a.approvalState?.steps?.email as { status: string; code?: string } | undefined;
  const welcomeNotSent = a.status === "approved" && emailStep?.status !== "done";

  return (
    <s-page heading={a.companyName}>
      <s-link slot="breadcrumb-actions" href={href(`/app/applications?${backQuery}`)}>{t("nav.applications")}</s-link>
      <ReviewKeys
        prev={d.nav.prev ? href(`/app/applications/${d.nav.prev}?back=${encodeURIComponent(backQuery)}`) : null}
        next={d.nav.next ? href(`/app/applications/${d.nav.next}?back=${encodeURIComponent(backQuery)}`) : null}
        open={open}
      />
      {open && (
        <>
          <s-button slot="primary-action" variant="primary" commandFor="approve-modal" command="--show">
            {t("applications.detail.approve")}
          </s-button>
          <ApproveDefaultsButton applicationId={a.id} />
          <s-button slot="secondary-actions" commandFor="needs-info-modal" command="--show">{t("applications.detail.needsInfo")}</s-button>
          <s-button slot="secondary-actions" commandFor="reject-modal" command="--show">{t("applications.detail.reject")}</s-button>
        </>
      )}
      <s-button slot="secondary-actions" onClick={async () => { if (!(await openFromApp(href(`/app/applications/${a.id}/print`)))) shopify.toast.show(t("errors.generic"), { isError: true }); }}>{t("applications.detail.print")}</s-button>

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <StatusBadge status={a.status} />
          <s-text color="subdued">
            {t("applications.detail.submitted")} <RelativeTime iso={a.submittedAt} />
          </s-text>
          {a.autoRuleId && <s-badge tone="info">{t("applications.detail.autoDecided")}</s-badge>}
          {a.flags.map((f) => (
            <s-badge key={f} tone="warning">{t(`applications.flag.${f}`)}</s-badge>
          ))}
          {open && waitingDays(a.submittedAt) >= d.staleDays && <s-badge tone="critical">{t("applications.waiting.days", { count: waitingDays(a.submittedAt) })}</s-badge>}
          {d.nav.position && <s-text color="subdued">{t("applications.detail.position", { n: d.nav.position, total: d.nav.total })}</s-text>}
        </s-stack>
        {d.risk.length > 0 && (
          // Hints only: they never block an approval (C14).
          <s-banner tone="warning" heading={t("applications.risk.heading")}>
            <s-unordered-list>
              {d.risk.map((h) => <s-list-item key={h}>{t(`applications.risk.${h}`)}</s-list-item>)}
            </s-unordered-list>
          </s-banner>
        )}
        {failedStep && (
          <s-banner tone="critical" heading={t("applications.detail.approvalFailed")}>
            <s-paragraph>{t(`approval.step.${failedStep[0]}`)}: {failedStep[1].error}</s-paragraph>
            <s-button commandFor="approve-modal" command="--show">{t("applications.detail.openApproval")}</s-button>
          </s-banner>
        )}
        {a.status === "rejected" && d.rejectionMessage && (
          <s-banner tone="info" heading={t("applications.status.rejected")}>
            {a.rejectReason && <s-paragraph>{a.rejectReason}</s-paragraph>}
            <RejectionMessageButton message={d.rejectionMessage} company={a.companyName} />
          </s-banner>
        )}
        {a.status === "needs_info" && a.requested && (
          <s-banner tone="info" heading={t("applications.detail.waitingForApplicant")}>
            <s-paragraph>{a.requested.message}</s-paragraph>
          </s-banner>
        )}
      </s-section>

      {a.status === "approved" && d.buyer && (
        <s-section heading={t("applications.detail.buyerHeading")}>
          <s-stack direction="block" gap="small-200">
            <s-text>{t("applications.detail.tier", { tier: d.tier?.name ?? "—" })}</s-text>
            <s-stack direction="inline" gap="base">
              <s-link href={href(`/app/buyers/${d.buyer.id}`)}>{t("applications.detail.viewBuyer")}</s-link>
              <s-link href={`shopify://admin/companies/${d.buyer.companyGid.split("/").pop()}`} target="_top">
                {t("applications.detail.openCompany")}
              </s-link>
              <s-link href={href(`/app/buyers/${d.buyer.id}`)}>{t("applications.detail.changeTier")}</s-link>
            </s-stack>
            {welcomeNotSent && emailStep?.code === "email_unavailable" && (
              <s-paragraph color="subdued">{t("approval.error.email_unavailable")}</s-paragraph>
            )}
            <NativeSetupLinks companyGid={d.buyer.companyGid} isPlus={d.isPlus} />
            {d.approvedMessage && (
              <s-stack direction="block" gap="small-200">
                {welcomeNotSent && <s-paragraph color="subdued">{t("applications.detail.accessEmailHint")}</s-paragraph>}
                <ApprovedMessageButton message={d.approvedMessage} company={a.companyName} />
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("applications.section.business")}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {STANDARD_SECTIONS.business.map(row)}
          {a.countryCode && (
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">{t("applications.col.country")}</s-text>
              <CountryName code={a.countryCode} />
            </s-stack>
          )}
        </s-grid>
      </s-section>

      {d.attribution && (
        <s-section heading={t("applications.section.source")}>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {(["utm_source", "utm_medium", "utm_campaign", "ref", "landing"] as const).filter((k) => d.attribution?.[k]).map((k) => (
              <s-stack key={k} direction="block" gap="small-400">
                <s-text color="subdued">{t(`applications.source.${k}`)}</s-text>
                <s-text>{d.attribution![k]}</s-text>
              </s-stack>
            ))}
          </s-grid>
        </s-section>
      )}

      <s-section heading={t("applications.section.contact")}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {STANDARD_SECTIONS.contact.map(row)}
        </s-grid>
      </s-section>

      <s-section heading={t("applications.section.addresses")}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {row("billingAddress")}
          {a.answers.shippingAddress ? row("shippingAddress") : (
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">{label("shippingAddress")}</s-text>
              <s-text>{t("applications.detail.sameAsBilling")}</s-text>
            </s-stack>
          )}
        </s-grid>
      </s-section>

      <s-section heading={t("applications.section.tax")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>{d.taxNumber ?? t("applications.detail.noTaxNumber")}</s-text>
            <TaxCheckBadge value={a.taxCheck} />
            {a.taxCheckName && <s-text color="subdued">{t("applications.detail.registryName", { name: a.taxCheckName })}</s-text>}
          </s-stack>
          {a.taxCheck === "unavailable" && <s-paragraph color="subdued">{t("applications.detail.checkManually")}</s-paragraph>}
          {/* US: one certificate per covered state, each with its official lookup and check mark. */}
          {d.certificates.filter((c) => c.country === "US" && c.region).map((c) => (
            <s-box key={c.id} padding="small-200" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">{t("applications.detail.usPermit", { state: c.region!, form: c.form ? t(`certificates.usForm.${c.form}`) : t(`certificates.type.${c.type}`) })}</s-text>
                <PermitCheck cert={c} liveAllowed={d.liveChecks} />
              </s-stack>
            </s-box>
          ))}
          {a.taxCheck === "skipped" && <s-paragraph color="subdued">{t("applications.detail.taxCheckPlan", { plan: "Starter" })}</s-paragraph>}
          {d.files.length === 0 ? (
            <s-text color="subdued">{t("applications.certificate.missing")}</s-text>
          ) : (
            <s-unordered-list>
              {d.files.map((f, i) => {
                // Matched by file, not by list position (files and certificates are separate lists).
                const cert = d.certificates.find((c) => c.fileGid === f.fileGid);
                return (
                  <s-list-item key={f.id}>
                    <s-button variant="tertiary" onClick={() => openDocument(f.id)}>
                      {t("applications.detail.document", { n: i + 1 })}
                    </s-button>
                    {cert?.expiresOn && <s-text color="subdued"> · {t("applications.detail.expires", { date: new Date(`${cert.expiresOn}T12:00:00Z`) })}</s-text>}
                  </s-list-item>
                );
              })}
            </s-unordered-list>
          )}
        </s-stack>
      </s-section>

      {(customAnswers.length > 0 || Boolean(a.answers.message)) && (
        <s-section heading={t("applications.section.answers")}>
          <s-stack direction="block" gap="base">
            {a.answers.message ? (
              <s-stack direction="block" gap="small-400">
                <s-text color="subdued">{label("message")}</s-text>
                <s-paragraph>{String(a.answers.message)}</s-paragraph>
              </s-stack>
            ) : null}
            {customAnswers.map(row)}
          </s-stack>
        </s-section>
      )}

      {d.duplicates.length > 0 && (
        <s-section heading={t("applications.section.duplicates")}>
          <s-unordered-list>
            {d.duplicates.map((dup) => (
              <s-list-item key={dup.id}>
                <s-link href={href(`/app/applications/${dup.id}`)}>{dup.companyName}</s-link> · {dup.email} · <StatusBadge status={dup.status} />
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      )}

      <s-section heading={t("applications.section.notes")}>
        <NotesAndAssignee notes={a.notes} assignee={a.assignee} />
      </s-section>

      <s-section heading={t("applications.section.activity")}>
        {d.activity.length === 0 ? (
          <s-text color="subdued">{t("applications.detail.noActivity")}</s-text>
        ) : (
          <s-unordered-list>
            {d.activity.map((e) => (
              <s-list-item key={e.id}>
                <RelativeTime iso={e.at} /> · {e.actor} · {activityLabel(t, e.action)}
                {e.result === "failed" && <s-badge tone="critical">{t("applications.detail.failed")}</s-badge>}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      {open && <ApproveModal applicationId={a.id} companyName={a.companyName} />}
      {a.status !== "pending" && a.status !== "needs_info" && failedStep && <ApproveModal applicationId={a.id} companyName={a.companyName} />}
      <NeedsInfoModal company={a.companyName} replies={d.replies.info} fields={d.fields.filter((f) => f.requestable).map((f) => ({ id: f.id, label: label(f.id) }))} />
      <RejectModal company={a.companyName} replies={d.replies.reject} />
    </s-page>
  );
}

function businessTypeLabel(t: (k: string) => string, v: string) {
  const key = `applications.businessType.${v}`;
  const s = t(key);
  return s === key ? v : s;
}

function activityLabel(t: (k: string) => string, action: string) {
  const key = `applications.activity.${action}`;
  const s = t(key);
  return s === key ? action : s;
}

function formatAddress(a: Record<string, string>, locale: string): string {
  let country = a.countryCode ?? "";
  try {
    country = a.countryCode ? new Intl.DisplayNames([locale], { type: "region" }).of(a.countryCode) ?? a.countryCode : "";
  } catch {
    // keep code
  }
  return [a.company, [a.firstName, a.lastName].filter(Boolean).join(" "), a.address1, a.address2, [a.zip, a.city, a.zoneCode].filter(Boolean).join(" "), country]
    .filter(Boolean)
    .join(", ");
}

function NotesAndAssignee({ notes, assignee }: { notes: { at: string; by: string; text: string }[]; assignee: string | null }) {
  const { t } = useI18n();
  const fetcher = useFetcher<DecisionData>();
  useDecisionResult(fetcher.data, fetcher.state, () => undefined);
  const [text, setText] = useState("");
  const [who, setWho] = useState(assignee ?? "");
  return (
    <s-stack direction="block" gap="base">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="assign" />
        <s-stack direction="inline" gap="small-200" alignItems="end">
          <s-text-field name="assignee" label={t("applications.detail.assignee")} details={t("applications.detail.assigneeHelp")} value={who} onInput={(e) => setWho((e.currentTarget as unknown as HTMLInputElement).value)} />
          <s-button type="submit">{t("common.save")}</s-button>
          <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "assign_me" }, { method: "POST" })}>{t("applications.detail.assignMe")}</s-button>
        </s-stack>
      </fetcher.Form>
      {notes.map((n, i) => (
        <s-box key={i} padding="small-200" background="subdued" borderRadius="base">
          <s-text color="subdued">
            <RelativeTime iso={n.at} /> · {n.by}
          </s-text>
          <s-paragraph>{n.text}</s-paragraph>
        </s-box>
      ))}
      <fetcher.Form method="post" onSubmit={() => setTimeout(() => setText(""), 0)}>
        <input type="hidden" name="intent" value="note" />
        <s-stack direction="block" gap="small-200">
          <s-text-area name="text" label={t("applications.detail.addNote")} value={text} onInput={(e) => setText((e.currentTarget as unknown as HTMLTextAreaElement).value)} />
          <s-button type="submit" disabled={!text.trim()}>{t("applications.detail.saveNote")}</s-button>
        </s-stack>
      </fetcher.Form>
    </s-stack>
  );
}

const INFO_TEMPLATES = ["certificate", "taxNumber", "business"] as const;
const REJECT_TEMPLATES = ["notEligible", "incomplete", "region"] as const;

type DecisionData = { ok: boolean; intent: string; error?: string; message?: ApplicantMessage | null };

/** Toast for a decision's result; on success the ready-made message for the applicant opens. */
function useDecisionResult(data: DecisionData | undefined, state: string, onMessage: (m: ApplicantMessage) => void) {
  const { t } = useI18n();
  const shopify = useAppBridge();
  useEffect(() => {
    if (state !== "idle" || !data) return;
    if (data.ok) {
      shopify.toast.show(t(`applications.detail.toast.${data.intent}`));
      if (data.message) onMessage(data.message);
    } else if (data.error) shopify.toast.show(t(`applications.detail.error.${data.error}`), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state]);
}

type Reply = { id: string; title: string; text: string };

/** Saved replies first (the merchant's own, B9), then the built-in suggestions. */
function ReplyPicker({ label, none, replies, builtIn, onPick }: { label: string; none: string; replies: Reply[]; builtIn: { value: string; label: string; text: string }[]; onPick: (text: string) => void }) {
  const { t } = useI18n();
  return (
    <s-select
      label={label}
      onChange={(e) => {
        const v = (e.currentTarget as unknown as HTMLSelectElement).value;
        const r = replies.find((x) => `saved:${x.id}` === v)?.text ?? builtIn.find((x) => `built:${x.value}` === v)?.text;
        onPick(r ?? "");
      }}
    >
      <s-option value="">{none}</s-option>
      {replies.length > 0 && (
        <s-option-group label={t("applications.reply.saved")}>
          {replies.map((r) => <s-option key={r.id} value={`saved:${r.id}`}>{r.title}</s-option>)}
        </s-option-group>
      )}
      <s-option-group label={t("applications.reply.builtIn")}>
        {builtIn.map((b) => <s-option key={b.value} value={`built:${b.value}`}>{b.label}</s-option>)}
      </s-option-group>
    </s-select>
  );
}

function NeedsInfoModal({ fields, company, replies }: { fields: { id: string; label: string }[]; company: string; replies: Reply[] }) {
  const { t } = useI18n();
  const fetcher = useFetcher<DecisionData>();
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [ready, setReady] = useState<ApplicantMessage | null>(null);
  useDecisionResult(fetcher.data, fetcher.state, (m) => {
    setReady(m);
    setMessage("");
    setPicked([]);
    setTouched(false);
  });
  const errMessage = touched && !message.trim() ? t("applications.needsInfo.messageRequired") : undefined;
  const errFields = touched && picked.length === 0 ? t("applications.needsInfo.fieldsRequired") : undefined;
  const submit = () => {
    setTouched(true);
    if (!message.trim() || picked.length === 0 || fetcher.state !== "idle") return;
    const fd = new FormData();
    fd.set("intent", "needs_info");
    fd.set("message", message);
    picked.forEach((f) => fd.append("fields", f));
    fetcher.submit(fd, { method: "POST" });
    (document.getElementById("needs-info-modal") as HTMLElement & { hideOverlay?: () => void })?.hideOverlay?.();
  };
  return (
    <>
      <s-modal id="needs-info-modal" heading={t("applications.needsInfo.heading")}>
        <s-stack direction="block" gap="base">
          <ReplyPicker
            label={t("applications.needsInfo.template")}
            none={t("applications.needsInfo.templateNone")}
            replies={replies}
            builtIn={INFO_TEMPLATES.map((k) => ({ value: k, label: t(`applications.needsInfo.templateName.${k}`), text: t(`applications.needsInfo.template.${k}`) }))}
            onPick={(text) => text && setMessage(text)}
          />
          <s-text-area label={t("applications.needsInfo.message")} value={message} error={errMessage} onInput={(e) => setMessage((e.currentTarget as unknown as HTMLTextAreaElement).value)} />
          <s-choice-list
            label={t("applications.needsInfo.fields")}
            details={t("applications.needsInfo.fieldsHelp")}
            multiple
            error={errFields}
            values={picked}
            onChange={(e) => setPicked([...((e.currentTarget as unknown as { values: string[] }).values ?? [])])}
          >
            {fields.map((f) => (
              <s-choice key={f.id} value={f.id}>{f.label}</s-choice>
            ))}
          </s-choice-list>
        </s-stack>
        <s-button slot="primary-action" variant="primary" loading={fetcher.state !== "idle"} onClick={submit}>{t("applications.needsInfo.send")}</s-button>
        <s-button slot="secondary-actions" commandFor="needs-info-modal" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>
      <MessageModal id="needs-info-message" company={company} message={ready} withLink onClose={() => setReady(null)} />
    </>
  );
}

function RejectModal({ company, replies }: { company: string; replies: Reply[] }) {
  const { t } = useI18n();
  const fetcher = useFetcher<DecisionData>();
  const [reason, setReason] = useState("");
  const [ready, setReady] = useState<ApplicantMessage | null>(null);
  useDecisionResult(fetcher.data, fetcher.state, setReady);
  return (
    <>
      <s-modal id="reject-modal" heading={t("applications.reject.heading", { company })}>
        <s-stack direction="block" gap="base">
          <ReplyPicker
            label={t("applications.reject.template")}
            none={t("applications.reject.templateNone")}
            replies={replies}
            builtIn={REJECT_TEMPLATES.map((k) => ({ value: k, label: t(`applications.reject.templateName.${k}`), text: t(`applications.reject.template.${k}`) }))}
            onPick={setReason}
          />
          <s-text-area label={t("applications.reject.reason")} details={t("applications.reject.reasonHelp")} value={reason} onInput={(e) => setReason((e.currentTarget as unknown as HTMLTextAreaElement).value)} />
          <s-paragraph>{t("applications.reject.consequence")}</s-paragraph>
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="reject-modal"
          command="--hide"
          disabled={fetcher.state !== "idle"}
          onClick={() => fetcher.submit({ intent: "reject", reason }, { method: "POST" })}
        >
          {t("applications.reject.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="reject-modal" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>
      <MessageModal id="reject-message" company={company} message={ready} onClose={() => setReady(null)} />
    </>
  );
}

/**
 * Keyboard shortcuts for working through the queue (C13): J / K next and previous, A approve,
 * M ask for more info, R reject, ? shows the list. Ignored while typing in a field or a dialog is open.
 */
function ReviewKeys({ prev, next, open }: { prev: string | null; next: string | null; open: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || !el) return;
      if (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable || el.closest("s-modal, [role=dialog], s-text-field, s-text-area, s-select")) return;
      const show = (id: string) => (document.getElementById(id) as HTMLElement & { showOverlay?: () => void } | null)?.showOverlay?.();
      const k = e.key.toLowerCase();
      if (k === "j" && next) navigate(next);
      else if (k === "k" && prev) navigate(prev);
      else if (k === "a" && open) show("approve-modal");
      else if (k === "m" && open) show("needs-info-modal");
      else if (k === "r" && open) show("reject-modal");
      else if (e.key === "?") setHelp((h) => !h);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, open, navigate]);
  return (
    <>
      {prev && <s-button slot="secondary-actions" href={prev} accessibilityLabel={t("applications.nav.prevLabel")}>{t("applications.nav.prev")}</s-button>}
      {next && <s-button slot="secondary-actions" href={next} accessibilityLabel={t("applications.nav.nextLabel")}>{t("applications.nav.next")}</s-button>}
      <s-button slot="secondary-actions" onClick={() => setHelp((h) => !h)}>{t("applications.keys.button")}</s-button>
      {help && (
        <s-section heading={t("applications.keys.heading")}>
          <s-unordered-list>
            {(["next", "prev", "approve", "info", "reject", "help"] as const).map((k) => <s-list-item key={k}>{t(`applications.keys.${k}`)}</s-list-item>)}
          </s-unordered-list>
        </s-section>
      )}
    </>
  );
}

/** "Approve with defaults" (C13): the suggested tier, terms, tax and contact, no dialog. Progress opens in the approve dialog on failure. */
function ApproveDefaultsButton({ applicationId }: { applicationId: string }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher<{ ok: boolean; message?: string; state?: { finishedAt?: string } | null }>();
  const revalidator = useRevalidator();
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    if (d.ok && d.state?.finishedAt) shopify.toast.show(t("applications.detail.approvedDefaults"));
    else {
      shopify.toast.show(d.message ?? t("applications.detail.approvalFailed"), { isError: true });
      (document.getElementById("approve-modal") as HTMLElement & { showOverlay?: () => void } | null)?.showOverlay?.();
    }
    revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  return (
    <s-button slot="secondary-actions" loading={fetcher.state !== "idle"} disabled={fetcher.state !== "idle"}
      onClick={() => fetcher.submit({ intent: "approve_defaults" }, { method: "POST", action: href(`/app/applications/${applicationId}/approve`) })}>
      {t("applications.detail.approveDefaults")}
    </s-button>
  );
}

/**
 * After approval: short links to the Shopify B2B settings Tradepass doesn't rebuild (C20) — the company
 * (payment terms, contacts), catalogs (volume pricing and quantity rules) and, on Plus, deposits.
 */
function NativeSetupLinks({ companyGid, isPlus }: { companyGid: string; isPlus: boolean }) {
  const { t } = useI18n();
  const id = companyGid.split("/").pop();
  return (
    <s-stack direction="block" gap="small-200">
      <s-text type="strong">{t("applications.native.heading")}</s-text>
      <s-unordered-list>
        <s-list-item><s-link href="shopify://admin/catalogs" target="_top">{t("applications.native.catalogs")}</s-link></s-list-item>
        <s-list-item><s-link href={`shopify://admin/companies/${id}`} target="_top">{t("applications.native.terms")}</s-link></s-list-item>
        {isPlus && <s-list-item><s-link href={`shopify://admin/companies/${id}`} target="_top">{t("applications.native.deposits")}</s-link></s-list-item>}
      </s-unordered-list>
    </s-stack>
  );
}

/** An approved application keeps its "you're approved" message (sign-in link, tier), ready to copy. */
function ApprovedMessageButton({ message, company }: { message: ApplicantMessage; company: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <s-button onClick={() => setOpen(true)}>{t("applications.detail.messageBuyer")}</s-button>
      <MessageModal id="approved-message" company={company} message={open ? message : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** A rejected application keeps its "not approved" message, ready to copy again. */
function RejectionMessageButton({ message, company }: { message: ApplicantMessage; company: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <s-button onClick={() => setOpen(true)}>{t("applications.detail.copyMessage")}</s-button>
      <MessageModal id="rejection-message-again" company={company} message={open ? message : null} onClose={() => setOpen(false)} />
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
