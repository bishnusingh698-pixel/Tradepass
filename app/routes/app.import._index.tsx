import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { can } from "../lib/plans";
import { paymentTermsOptions } from "../lib/tiers.server";
import { createCsvRun, createTagRun, ImportFileError, MAX_ROWS, previewTagCount, startRun, TAX_EXEMPTION_SET } from "../lib/import.server";
import { logActivity } from "../lib/activity.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { ImportRunBadge as RunBadge } from "../components/ImportRunBadge";

const flag = (name: string, on: boolean | undefined) => (on ? { [name]: true } : {});
const splitList = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const allowed = can(ctx.plan, "import");
  const [runs, tiers, terms] = await Promise.all([
    db.importRun.findMany({ where: { shop: ctx.shop }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, kind: true, state: true, total: true, done: true, createdAt: true } }),
    db.tier.findMany({ where: { shop: ctx.shop }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    allowed ? paymentTermsOptions(ctx.admin) : Promise.resolve([]),
  ]);
  return {
    allowed,
    runs: runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    tiers,
    terms: terms.map((p) => ({ id: p.id, name: p.name })),
    maxRows: MAX_ROWS,
  };
};

type ActionData = { ok: false; intent: string; error: string } | { ok: true; intent: "preview"; count: number; capped: boolean };

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  if (!can(ctx.plan, "import")) return { ok: false, intent: "any", error: "import.error.plan" } satisfies ActionData;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "upload") {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, intent, error: "import.error.noFile" } satisfies ActionData;
    try {
      const run = await createCsvRun(ctx.shop, await file.text());
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "import.upload", subject: run.id, detail: { rows: run.total } });
      return redirect(`/app/import/${run.id}?locale=${ctx.i18n.locale}`);
    } catch (e) {
      if (e instanceof ImportFileError) return { ok: false, intent, error: `import.error.file.${e.code}` } satisfies ActionData;
      throw e;
    }
  }

  const tags = splitList(form.get("tags"));
  if (!tags.length) return { ok: false, intent, error: "import.error.tagsRequired" } satisfies ActionData;

  if (intent === "preview") {
    const { count, capped } = await previewTagCount(ctx.admin, tags);
    return { ok: true, intent, count, capped } satisfies ActionData;
  }

  if (intent === "convert") {
    const tierId = String(form.get("tierId") ?? "");
    if (!(await db.tier.findFirst({ where: { shop: ctx.shop, id: tierId } }))) return { ok: false, intent, error: "import.error.tierRequired" } satisfies ActionData;
    const exemptions = splitList(form.get("exemptions")).map((x) => x.toUpperCase());
    if (exemptions.some((x) => !TAX_EXEMPTION_SET.has(x))) return { ok: false, intent, error: "import.error.exemption" } satisfies ActionData;
    const taxExempt = form.get("tax") === "exempt";
    const run = await createTagRun(ctx.shop, {
      tags,
      tierId,
      paymentTermsTemplateId: String(form.get("termsId") ?? "") || null,
      taxExempt,
      exemptions: taxExempt ? exemptions : [],
      sendWelcome: form.get("sendWelcome") === "on",
      preview: Number(form.get("preview")) || 0,
    });
    await startRun(ctx.shop, run.id, ctx.actor);
    return redirect(`/app/import/${run.id}?locale=${ctx.i18n.locale}`);
  }
  return { ok: false, intent, error: "import.error.generic" } satisfies ActionData;
};

export default function ImportPage() {
  const d = useLoaderData<typeof loader>();
  const { t, i18n } = useI18n();
  const href = useLocaleHref();
  const upload = useFetcher<typeof action>();
  const tag = useFetcher<typeof action>();
  const locked = !d.allowed;

  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState("");
  const [tierId, setTierId] = useState(d.tiers[0]?.id ?? "");
  const [termsId, setTermsId] = useState("");
  const [tax, setTax] = useState<"charge" | "exempt">("charge");
  const [exemptions, setExemptions] = useState("");
  const [sendWelcome, setSendWelcome] = useState(true);
  const [preview, setPreview] = useState<{ count: number; capped: boolean } | null>(null);

  const uploadError = upload.data && !upload.data.ok ? t(upload.data.error) : undefined;
  const tagError = tag.data && !tag.data.ok ? t(tag.data.error) : undefined;
  useEffect(() => {
    if (tag.state === "idle" && tag.data?.ok && tag.data.intent === "preview") setPreview({ count: tag.data.count, capped: tag.data.capped });
  }, [tag.state, tag.data]);
  useEffect(() => setPreview(null), [tags]);

  const submitTag = (intent: "preview" | "convert") =>
    tag.submit({ intent, tags, tierId, termsId, tax, exemptions, sendWelcome: sendWelcome ? "on" : "", preview: String(preview?.count ?? 0) }, { method: "POST" });

  return (
    <s-page heading={t("import.title")}>
      {locked && (
        <s-banner tone="info" heading={t("common.availableOn", { plan: "Pro" })}>
          <s-paragraph>{t("import.locked")}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={t("import.csv.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("import.csv.body", { max: d.maxRows })}</s-paragraph>
          <s-link href="/app/import/template" download="tradepass-import-template.csv">{t("import.csv.template")}</s-link>
          <s-drop-zone
            accept=".csv,text/csv"
            label={t("import.csv.file")}
            error={uploadError}
            {...flag("disabled", locked)}
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
          {file && <s-text>{t("import.csv.chosen", { name: file.name })}</s-text>}
          <s-button
            variant="primary"
            {...flag("disabled", locked || !file)}
            {...flag("loading", upload.state !== "idle")}
            onClick={() => {
              if (!file) return;
              const fd = new FormData();
              fd.set("intent", "upload");
              fd.set("file", file);
              upload.submit(fd, { method: "POST", encType: "multipart/form-data" });
            }}
          >
            {t("import.csv.upload")}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={t("import.tag.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("import.tag.body")}</s-paragraph>
          {!d.tiers.length && !locked && <s-banner tone="warning">{t("import.tag.noTiers")}</s-banner>}
          <s-text-field label={t("import.tag.tags")} details={t("import.tag.tagsHelp")} value={tags} {...flag("disabled", locked)} onInput={(e) => setTags(e.currentTarget.value)} />
          <s-select label={t("import.tag.tier")} value={tierId} {...flag("disabled", locked)} onChange={(e) => setTierId(e.currentTarget.value)}>
            {d.tiers.map((tier) => <s-option key={tier.id} value={tier.id}>{tier.name}</s-option>)}
          </s-select>
          <s-select label={t("import.tag.terms")} value={termsId} {...flag("disabled", locked)} onChange={(e) => setTermsId(e.currentTarget.value)}>
            <s-option value="">{t("import.tag.noTerms")}</s-option>
            {d.terms.map((p) => <s-option key={p.id} value={p.id}>{p.name}</s-option>)}
          </s-select>
          <s-select label={t("import.tag.tax")} value={tax} {...flag("disabled", locked)} onChange={(e) => setTax(e.currentTarget.value as "charge" | "exempt")}>
            <s-option value="charge">{t("import.tag.taxCharge")}</s-option>
            <s-option value="exempt">{t("import.tag.taxExempt")}</s-option>
          </s-select>
          {tax === "exempt" && (
            <s-text-field label={t("import.tag.exemptions")} details={t("import.tag.exemptionsHelp")} value={exemptions} {...flag("disabled", locked)} onInput={(e) => setExemptions(e.currentTarget.value)} />
          )}
          <s-checkbox label={t("import.tag.sendWelcome")} checked={sendWelcome} {...flag("disabled", locked)} onChange={(e) => setSendWelcome(e.currentTarget.checked)} />
          {tagError && <s-banner tone="critical">{tagError}</s-banner>}
          {preview && (
            <s-paragraph>
              {preview.capped ? t("import.tag.previewCapped", { count: preview.count }) : t("import.tag.preview", { count: preview.count })}
            </s-paragraph>
          )}
          <s-stack direction="inline" gap="base">
            <s-button {...flag("disabled", locked || !tags.trim())} {...flag("loading", tag.state !== "idle" && tag.formData?.get("intent") === "preview")} onClick={() => submitTag("preview")}>
              {t("import.tag.previewButton")}
            </s-button>
            <s-button variant="primary" commandFor="convert-modal" command="--show" {...flag("disabled", locked || !preview?.count || !tierId)}>
              {t("import.tag.convert", { count: preview?.count ?? 0 })}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-modal id="convert-modal" heading={t("import.tag.confirmHeading", { count: preview?.count ?? 0 })}>
        <s-paragraph>
          {t("import.tag.confirmBody", { count: preview?.count ?? 0, tags, tier: d.tiers.find((x) => x.id === tierId)?.name ?? "" })}
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" commandFor="convert-modal" command="--hide" onClick={() => submitTag("convert")}>
          {t("import.tag.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="convert-modal" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>

      <s-section heading={t("import.runs.heading")}>
        {d.runs.length === 0 ? (
          <s-paragraph>{t("import.runs.none")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("import.runs.kind")}</s-table-header>
              <s-table-header>{t("import.runs.started")}</s-table-header>
              <s-table-header>{t("import.runs.state")}</s-table-header>
              <s-table-header>{t("import.runs.progress")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.runs.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell><s-link href={href(`/app/import/${r.id}`)}>{t(`import.kind.${r.kind === "tag" ? "tag" : "csv"}`)}</s-link></s-table-cell>
                  <s-table-cell>{i18n.date(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short" })}</s-table-cell>
                  <s-table-cell><RunBadge state={r.state} /></s-table-cell>
                  <s-table-cell>{t("import.runs.count", { done: r.done, total: r.total })}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
