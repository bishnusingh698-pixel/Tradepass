import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { can } from "../lib/plans";
import { paymentTermsOptions } from "../lib/tiers.server";
import { cancelRun, getRun, processImportRun, runData, startRun, summarize, TAX_EXEMPTION_SET, validateCsvRun, type CsvData } from "../lib/import.server";
import { IMPORT_FIELDS, REQUIRED_FIELDS, type ColumnMap, type CsvOptions, type ImportField, type Issue } from "../lib/import";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { ImportRunBadge as RunBadge } from "../components/ImportRunBadge";

const flag = (name: string, on: boolean | undefined) => (on ? { [name]: true } : {});
const ISSUES_SHOWN = 100;
// One browser-driven step; the row margin in processImportRun keeps it well inside request timeouts.
const STEP_MS = 25_000;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const run = await getRun(ctx.shop, params.id ?? "");
  if (!run) throw new Response("Not found", { status: 404 });
  const data = runData(run);
  const editable = run.kind === "csv" && (run.state === "draft" || run.state === "validated");
  const [tiers, terms] = await Promise.all([
    db.tier.findMany({ where: { shop: ctx.shop }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    editable ? paymentTermsOptions(ctx.admin) : Promise.resolve([]),
  ]);
  const csv = data.kind === "csv" ? (data as CsvData) : null;
  const issues = (run.errors ?? []) as Issue[];
  return {
    allowed: can(ctx.plan, "import"),
    run: { id: run.id, kind: run.kind, state: run.state, total: run.total, done: run.done, cursor: run.cursor },
    editable,
    headers: csv?.headers ?? [],
    // First data row, so each column in the mapping shows an example value.
    sample: csv?.raw?.[0] ?? [],
    map: csv?.map ?? {},
    options: csv?.options ?? { defaultTierId: null, onExisting: "skip", sendWelcome: false },
    summary: run.state === "validated" ? summarize(run) : null,
    issues: issues.slice(0, ISSUES_SHOWN),
    issueCount: issues.length,
    errorCount: issues.filter((i) => i.level === "error").length,
    tiers,
    terms: terms.map((p) => ({ id: p.id, name: p.name })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  if (!can(ctx.plan, "import")) return { ok: false, intent: "any" };
  const id = params.id ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "validate") {
    const map = JSON.parse(String(form.get("map") ?? "{}")) as ColumnMap;
    const options = JSON.parse(String(form.get("options") ?? "{}")) as CsvOptions;
    const missing = REQUIRED_FIELDS.filter((f) => map[f] === null || map[f] === undefined);
    if (missing.length) return { ok: false, intent, missing };
    const [tiers, terms] = await Promise.all([
      db.tier.findMany({ where: { shop: ctx.shop }, select: { id: true, name: true } }),
      paymentTermsOptions(ctx.admin),
    ]);
    if (options.defaultTierId && !tiers.some((x) => x.id === options.defaultTierId)) options.defaultTierId = null;
    await validateCsvRun(ctx.admin, ctx.shop, id, map, options, { tiers, terms, exemptionValues: TAX_EXEMPTION_SET });
    return { ok: true, intent };
  }
  if (intent === "start") return { ok: await startRun(ctx.shop, id, ctx.actor), intent };
  if (intent === "continue") {
    const processed = await processImportRun(ctx.admin, ctx.shop, id, Date.now() + STEP_MS);
    return { ok: true, intent, processed };
  }
  if (intent === "cancel") {
    await cancelRun(ctx.shop, id, ctx.actor);
    return { ok: true, intent };
  }
  return { ok: false, intent };
};

export default function ImportRunPage() {
  const d = useLoaderData<typeof loader>();
  const { t, i18n } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const step = useFetcher<typeof action>();
  const other = useFetcher<typeof action>();

  const [map, setMap] = useState<ColumnMap>(d.map as ColumnMap);
  const [options, setOptions] = useState<CsvOptions>(d.options as CsvOptions);
  const [submitted, setSubmitted] = useState(false);
  const missing = submitted && other.data && "missing" in other.data ? (other.data.missing as ImportField[]) : [];

  // While the page is open, keep a running import moving: one step at a time.
  const running = d.run.state === "running" && d.allowed;
  useEffect(() => {
    if (!running || step.state !== "idle") return;
    // A step that processed nothing means another worker holds the run (e.g. the hourly job): wait longer.
    const idleWait = step.data && "processed" in step.data && step.data.processed === 0 ? 5_000 : 300;
    const timer = setTimeout(() => {
      step.submit({ intent: "continue" }, { method: "POST" });
    }, step.data ? idleWait : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run after each step completes
  }, [running, step.state]);
  useEffect(() => {
    if (step.state === "idle" && step.data) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh progress after each step
  }, [step.state, step.data]);
  useEffect(() => {
    if (other.state === "idle" && other.data?.ok && other.data.intent === "validate") shopify.toast.show(t("import.map.checked"));
  }, [other.state, other.data, shopify, t]);

  const pct = d.run.total ? Math.min(100, Math.round((d.run.done / d.run.total) * 100)) : 0;
  const busy = other.state !== "idle";
  const fieldLabel = (f: ImportField) => t(`import.field.${f}`);

  return (
    <s-page heading={t(d.run.kind === "tag" ? "import.run.tagTitle" : "import.run.csvTitle")}>
      <s-link slot="breadcrumb-actions" href={href("/app/import")}>{t("import.title")}</s-link>
      {(d.run.state === "running" || d.run.state === "validated" || d.run.state === "draft") && (
        <s-button slot="secondary-actions" tone="critical" commandFor="cancel-modal" command="--show">{t("import.run.cancel")}</s-button>
      )}

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <RunBadge state={d.run.state} />
          {!d.allowed && <s-badge tone="info">{t("common.availableOn", { plan: "Pro" })}</s-badge>}
        </s-stack>
      </s-section>

      {d.editable && (
        <form
          data-save-bar
          data-discard-confirmation
          onReset={() => { setMap(d.map as ColumnMap); setOptions(d.options as CsvOptions); setSubmitted(false); }}
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            other.submit({ intent: "validate", map: JSON.stringify(map), options: JSON.stringify(options) }, { method: "POST" });
          }}
        >
          <s-section heading={t("import.map.heading")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("import.map.body")}</s-paragraph>
              {missing.length > 0 && (
                <s-banner tone="critical" heading={t("import.map.missing", { count: missing.length })}>
                  <s-paragraph>{missing.map(fieldLabel).join(", ")}</s-paragraph>
                </s-banner>
              )}
              {IMPORT_FIELDS.map((f) => {
                const idx = map[f];
                const example = idx !== null && idx !== undefined ? d.sample[idx] : "";
                return (
                  <s-select
                    key={f}
                    label={REQUIRED_FIELDS.includes(f) ? t("import.map.required", { field: fieldLabel(f) }) : fieldLabel(f)}
                    details={example ? t("import.map.example", { value: example }) : undefined}
                    value={idx === null || idx === undefined ? "" : String(idx)}
                    error={missing.includes(f) ? t("import.map.requiredError") : undefined}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setMap((m) => ({ ...m, [f]: v === "" ? null : Number(v) }));
                    }}
                  >
                    <s-option value="">{t("import.map.skip")}</s-option>
                    {d.headers.map((h, i) => <s-option key={i} value={String(i)}>{h || t("import.map.column", { number: i + 1 })}</s-option>)}
                  </s-select>
                );
              })}
            </s-stack>
          </s-section>
          <s-section heading={t("import.options.heading")}>
            <s-stack direction="block" gap="base">
              <s-select label={t("import.options.defaultTier")} details={t("import.options.defaultTierHelp")} value={options.defaultTierId ?? ""} onChange={(e) => setOptions((o) => ({ ...o, defaultTierId: e.currentTarget.value || null }))}>
                <s-option value="">{t("import.options.noDefaultTier")}</s-option>
                {d.tiers.map((tier) => <s-option key={tier.id} value={tier.id}>{tier.name}</s-option>)}
              </s-select>
              <s-select label={t("import.options.existing")} value={options.onExisting} onChange={(e) => setOptions((o) => ({ ...o, onExisting: e.currentTarget.value as CsvOptions["onExisting"] }))}>
                <s-option value="skip">{t("import.options.existingSkip")}</s-option>
                <s-option value="link">{t("import.options.existingLink")}</s-option>
              </s-select>
              <s-checkbox label={t("import.options.sendWelcome")} checked={options.sendWelcome} onChange={(e) => setOptions((o) => ({ ...o, sendWelcome: e.currentTarget.checked }))} />
              <s-button type="submit" {...flag("loading", busy)} {...flag("disabled", !d.allowed)}>{t("import.map.check")}</s-button>
            </s-stack>
          </s-section>
        </form>
      )}

      {d.summary && (
        <s-section heading={t("import.dry.heading")}>
          <s-stack direction="block" gap="base">
            <s-unordered-list>
              <s-list-item>{t("import.dry.ready", { count: d.summary.ready })}</s-list-item>
              <s-list-item>{t("import.dry.errors", { count: d.summary.errors })}</s-list-item>
              <s-list-item>{t("import.dry.skipped", { count: d.summary.skipped })}</s-list-item>
              <s-list-item>{t("import.dry.warnings", { count: d.summary.warnings })}</s-list-item>
            </s-unordered-list>
            <s-paragraph color="subdued">{t("import.dry.note")}</s-paragraph>
            <s-button variant="primary" commandFor="start-modal" command="--show" {...flag("disabled", !d.summary.ready || !d.allowed)}>
              {t("import.dry.start", { count: d.summary.ready })}
            </s-button>
          </s-stack>
        </s-section>
      )}

      {(d.run.state === "running" || d.run.state === "done" || d.run.state === "failed") && (
        <s-section heading={t("import.progress.heading")}>
          <s-stack direction="block" gap="small">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={t("import.progress.label")}
              style={{ blockSize: "8px", inlineSize: "100%", background: "var(--s-color-bg-fill-secondary, #e3e3e3)", borderRadius: "4px", overflow: "hidden" }}
            >
              <div style={{ blockSize: "100%", inlineSize: `${pct}%`, background: "var(--s-color-bg-fill-brand, #303030)" }} />
            </div>
            <s-text>{t("import.progress.count", { done: i18n.number(d.run.done), total: i18n.number(d.run.total) })}</s-text>
            {d.run.state === "running" && <s-paragraph color="subdued">{t("import.progress.resume")}</s-paragraph>}
          </s-stack>
        </s-section>
      )}

      {d.issueCount > 0 && (
        <s-section heading={t("import.issues.heading", { count: d.issueCount })}>
          <s-stack direction="block" gap="base">
            <s-link href={href(`/app/import/${d.run.id}/errors`)} download={`tradepass-import-errors-${d.run.id}.csv`}>{t("import.issues.download")}</s-link>
            <s-table>
              <s-table-header-row>
                <s-table-header>{t("import.report.row")}</s-table-header>
                <s-table-header>{t("import.report.column")}</s-table-header>
                <s-table-header>{t("import.report.message")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.issues.map((i, k) => (
                  <s-table-row key={k}>
                    <s-table-cell>{i.row}</s-table-cell>
                    <s-table-cell>{i.field ? fieldLabel(i.field) : "—"}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-badge tone={i.level === "error" ? "critical" : "warning"}>{t(`import.level.${i.level}`)}</s-badge>
                        <s-text>{t(`import.issue.${i.code}`)}</s-text>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            {d.issueCount > d.issues.length && <s-paragraph color="subdued">{t("import.issues.more", { count: d.issueCount - d.issues.length })}</s-paragraph>}
          </s-stack>
        </s-section>
      )}

      <s-modal id="start-modal" heading={t("import.start.heading", { count: d.summary?.ready ?? 0 })}>
        <s-paragraph>{t("import.start.body", { count: d.summary?.ready ?? 0 })}</s-paragraph>
        <s-button slot="primary-action" variant="primary" commandFor="start-modal" command="--hide" onClick={() => other.submit({ intent: "start" }, { method: "POST" })}>
          {t("import.start.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="start-modal" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>

      <s-modal id="cancel-modal" heading={t("import.cancel.heading")}>
        <s-paragraph>{t("import.cancel.body", { done: d.run.done })}</s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" commandFor="cancel-modal" command="--hide" onClick={() => other.submit({ intent: "cancel" }, { method: "POST" })}>
          {t("import.cancel.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="cancel-modal" command="--hide">{t("import.cancel.keep")}</s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
