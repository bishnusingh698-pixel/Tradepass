import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { addNote, getApplication, rejectApplication, requestMoreInfo, setAssignee } from "../lib/applications.server";
import type { FormDefinition } from "../lib/form-defaults";
import { defaultFormDefinition } from "../lib/form-defaults";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { CountryName, RelativeTime, StatusBadge, TaxCheckBadge } from "../components/applications";
import { ApproveModal } from "../components/ApproveModal";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const found = await getApplication(ctx.shop, params.id!);
  if (!found) throw new Response("Not found", { status: 404 });
  const { app, taxNumber, files, certificates, activity, duplicates, buyer } = found;
  const form = app.formId ? await db.form.findFirst({ where: { shop: ctx.shop, id: app.formId } }) : null;
  const definition = (form?.definition as FormDefinition | undefined) ?? defaultFormDefinition();
  const tier = buyer?.tierId ? await db.tier.findFirst({ where: { shop: ctx.shop, id: buyer.tierId }, select: { id: true, name: true } }) : null;
  return {
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
      submittedAt: app.submittedAt.toISOString(),
      decidedAt: app.decidedAt?.toISOString() ?? null,
      source: app.source,
      autoRuleId: app.autoRuleId,
      approvalState: app.approvalState as { steps?: Record<string, { status: string; error?: string }> } | null,
    },
    taxNumber,
    files: files.map((f) => ({ id: f.id, kind: f.kind, createdAt: f.createdAt.toISOString() })),
    certificates: certificates.map((c) => ({
      id: c.id, type: c.type, country: c.country, region: c.region, expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null, status: c.status,
    })),
    activity: activity.map((a) => ({ id: a.id, actor: a.actor, action: a.action, result: a.result, at: a.createdAt.toISOString() })),
    duplicates: duplicates.map((d) => ({ ...d, submittedAt: d.submittedAt.toISOString() })),
    buyer: buyer ? { id: buyer.id, companyGid: buyer.companyGid, status: buyer.status } : null,
    tier,
    fields: definition.sections.flatMap((s) => s.fields.filter((f) => f.state !== "hidden").map((f) => ({ id: f.id, custom: Boolean(f.custom), label: f.texts?.en?.label ?? null }))),
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
      const ok = await rejectApplication(dctx, id, {
        reason: String(form.get("reason") ?? "").trim() || null,
        email: form.get("email") === "on",
      });
      return { ok, intent };
    }
    case "needs_info": {
      const message = String(form.get("message") ?? "").trim();
      const fields = form.getAll("fields").map(String);
      if (!message) return { ok: false, intent, error: "message_required" };
      if (!fields.length) return { ok: false, intent, error: "fields_required" };
      const res = await requestMoreInfo(dctx, id, { message, fields });
      return { ok: res.ok, intent };
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
  }
  return { ok: false, intent: "unknown" };
};

const STANDARD_SECTIONS: Record<string, string[]> = {
  business: ["companyName", "businessType", "website", "yearEstablished", "locationsCount", "monthlyOrderValue", "referral"],
  contact: ["firstName", "lastName", "email", "phone", "jobTitle", "preferredLanguage"],
};
const HANDLED = new Set([...STANDARD_SECTIONS.business, ...STANDARD_SECTIONS.contact, "billingAddress", "shippingAddress", "taxNumber", "certificates", "message", "consent", "taxNumberHash", "certificateMeta", "taxState", "taxCountry"]);

export default function ApplicationDetail() {
  const d = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const [params] = useSearchParams();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const a = d.app;
  const open = a.status === "pending" || a.status === "needs_info";
  const backQuery = params.get("back") ?? "tab=pending";

  useEffect(() => {
    const r = fetcher.data;
    if (r?.ok) shopify.toast.show(t(`applications.detail.toast.${r.intent}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

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
        <s-text>{fieldId === "companyName" ? a.companyName : fieldId === "email" ? a.email : fieldId === "businessType" && a.businessType ? businessTypeLabel(t, a.businessType) : value(a.answers[fieldId])}</s-text>
      </s-stack>
    ) : null;

  const customAnswers = Object.keys(a.answers).filter((k) => !HANDLED.has(k));
  const failedStep = a.approvalState?.steps ? Object.entries(a.approvalState.steps).find(([, s]) => s.status === "failed") : null;

  return (
    <s-page heading={a.companyName}>
      <s-link slot="breadcrumb-actions" href={href(`/app/applications?${backQuery}`)}>{t("nav.applications")}</s-link>
      {open && (
        <>
          <s-button slot="primary-action" variant="primary" commandFor="approve-modal" command="--show">
            {t("applications.detail.approve")}
          </s-button>
          <s-button slot="secondary-actions" commandFor="needs-info-modal" command="--show">{t("applications.detail.needsInfo")}</s-button>
          <s-button slot="secondary-actions" commandFor="reject-modal" command="--show">{t("applications.detail.reject")}</s-button>
        </>
      )}

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
        </s-stack>
        {failedStep && (
          <s-banner tone="critical" heading={t("applications.detail.approvalFailed")}>
            <s-paragraph>{t(`approval.step.${failedStep[0]}`)}: {failedStep[1].error}</s-paragraph>
            <s-button commandFor="approve-modal" command="--show">{t("applications.detail.openApproval")}</s-button>
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
          {d.files.length === 0 ? (
            <s-text color="subdued">{t("applications.certificate.missing")}</s-text>
          ) : (
            <s-unordered-list>
              {d.files.map((f, i) => {
                const cert = d.certificates[i];
                return (
                  <s-list-item key={f.id}>
                    <s-link href={`/app/files/${f.id}`} target="_blank">
                      {t("applications.detail.document", { n: i + 1 })}
                    </s-link>
                    {cert?.expiresOn && <s-text color="subdued"> · {t("applications.detail.expires", { date: new Date(cert.expiresOn) })}</s-text>}
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
      <NeedsInfoModal fields={d.fields.map((f) => ({ id: f.id, label: label(f.id) }))} />
      <RejectModal company={a.companyName} />
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
  const fetcher = useFetcher();
  const [text, setText] = useState("");
  const [who, setWho] = useState(assignee ?? "");
  return (
    <s-stack direction="block" gap="base">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="assign" />
        <s-stack direction="inline" gap="small-200" alignItems="end">
          <s-text-field name="assignee" label={t("applications.detail.assignee")} details={t("applications.detail.assigneeHelp")} value={who} onInput={(e) => setWho((e.currentTarget as unknown as HTMLInputElement).value)} />
          <s-button type="submit">{t("common.save")}</s-button>
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

function NeedsInfoModal({ fields }: { fields: { id: string; label: string }[] }) {
  const { t } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const errMessage = touched && !message.trim() ? t("applications.needsInfo.messageRequired") : undefined;
  const errFields = touched && picked.length === 0 ? t("applications.needsInfo.fieldsRequired") : undefined;
  const submit = () => {
    setTouched(true);
    if (!message.trim() || picked.length === 0) return;
    const fd = new FormData();
    fd.set("intent", "needs_info");
    fd.set("message", message);
    picked.forEach((f) => fd.append("fields", f));
    fetcher.submit(fd, { method: "POST" });
    (document.getElementById("needs-info-modal") as HTMLElement & { hideOverlay?: () => void })?.hideOverlay?.();
  };
  return (
    <s-modal id="needs-info-modal" heading={t("applications.needsInfo.heading")}>
      <s-stack direction="block" gap="base">
        <s-select
          label={t("applications.needsInfo.template")}
          onChange={(e) => {
            const v = (e.currentTarget as unknown as HTMLSelectElement).value;
            if (v) setMessage(t(`applications.needsInfo.template.${v}`));
          }}
        >
          <s-option value="">{t("applications.needsInfo.templateNone")}</s-option>
          {INFO_TEMPLATES.map((k) => (
            <s-option key={k} value={k}>{t(`applications.needsInfo.templateName.${k}`)}</s-option>
          ))}
        </s-select>
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
      <s-button slot="primary-action" variant="primary" onClick={submit}>{t("applications.needsInfo.send")}</s-button>
      <s-button slot="secondary-actions" commandFor="needs-info-modal" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

function RejectModal({ company }: { company: string }) {
  const { t } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState(true);
  return (
    <s-modal id="reject-modal" heading={t("applications.reject.heading", { company })}>
      <s-stack direction="block" gap="base">
        <s-select
          label={t("applications.reject.template")}
          onChange={(e) => {
            const v = (e.currentTarget as unknown as HTMLSelectElement).value;
            setReason(v ? t(`applications.reject.template.${v}`) : "");
          }}
        >
          <s-option value="">{t("applications.reject.templateNone")}</s-option>
          {REJECT_TEMPLATES.map((k) => (
            <s-option key={k} value={k}>{t(`applications.reject.templateName.${k}`)}</s-option>
          ))}
        </s-select>
        <s-text-area label={t("applications.reject.reason")} details={t("applications.reject.reasonHelp")} value={reason} onInput={(e) => setReason((e.currentTarget as unknown as HTMLTextAreaElement).value)} />
        <s-checkbox label={t("applications.reject.email")} checked={email} onChange={() => setEmail(!email)} />
        <s-paragraph>{t("applications.reject.consequence")}</s-paragraph>
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        commandFor="reject-modal"
        command="--hide"
        onClick={() => fetcher.submit({ intent: "reject", reason, ...(email ? { email: "on" } : {}) }, { method: "POST" })}
      >
        {t("applications.reject.confirm")}
      </s-button>
      <s-button slot="secondary-actions" commandFor="reject-modal" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
