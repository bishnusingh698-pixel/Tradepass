import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { getApplication } from "../lib/applications.server";
import { readDefinition } from "../lib/forms.server";
import { defaultFormDefinition } from "../lib/form-defaults";
import { esc } from "../lib/hosted-page.server";

// Print / save-as-PDF view of one application for the merchant's records (C18): plain HTML with a
// print stylesheet, opened from the admin through App Bridge (session token) as a blob. No PDF is
// made on the server; the browser's "Print → Save as PDF" does it. Tax numbers are masked.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const found = await getApplication(ctx.shop, params.id!);
  if (!found) return new Response("Not found", { status: 404 });
  const { app, taxNumber, files, certificates } = found;
  const { t, locale, dir } = ctx.i18n;
  const form = app.formId ? await db.form.findFirst({ where: { shop: ctx.shop, id: app.formId } }) : null;
  const def = form ? readDefinition(form.definition) : defaultFormDefinition();
  const a = (app.answers ?? {}) as Record<string, unknown>;
  const label = (id: string) => {
    const f = def.sections.flatMap((x) => x.fields).find((x) => x.id === id);
    if (f?.custom) return f.texts?.[locale]?.label ?? Object.values(f.texts ?? {}).find((x) => x?.label)?.label ?? id;
    const k = `applications.field.${id}`;
    const v = t(k);
    return v === k ? id : v;
  };
  const value = (v: unknown): string => {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.map(value).join(", ");
    if (typeof v === "boolean") return v ? t("applications.detail.yes") : t("applications.detail.no");
    if (typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([k]) => !/^(same|numberEnc|fileGid|ref)$/.test(k)).map(([, x]) => value(x)).filter((x) => x !== "—").join(", ");
    return String(v);
  };
  const skip = new Set(["taxNumberHash", "certificateMeta", "usPermits", "consent"]);
  const rows = Object.entries(a).filter(([k]) => !skip.has(k)).map(([k, v]) => `<tr><th>${esc(label(k))}</th><td>${esc(value(v))}</td></tr>`).join("");
  const date = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(d);
  const masked = taxNumber ? `${"•".repeat(Math.max(0, taxNumber.length - 4))}${taxNumber.slice(-4)}` : "—";
  const fileRows = files.map((f, i) => {
    const c = certificates.find((x) => x.fileGid === f.fileGid);
    return `<li>${esc(t("applications.detail.document", { n: i + 1 }))}${c?.region ? ` · ${esc(c.region)}` : ""}${c?.expiresOn ? ` · ${esc(t("applications.detail.expires", { date: c.expiresOn }))}` : ""} · ${esc(date(f.createdAt))}</li>`;
  }).join("");
  const html = `<!doctype html><html lang="${esc(locale)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(app.companyName)}</title>
<style>body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;max-width:52rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.5rem;margin:0 0 .25rem}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{text-align:start;vertical-align:top;padding:.35rem .5rem;border-bottom:1px solid #ddd}
th{width:35%;font-weight:600}.meta{color:#444}button{font:inherit;padding:.4rem 1rem}@media print{button{display:none}body{margin:0}}</style></head>
<body><button onclick="print()">${esc(t("applications.print.button"))}</button>
<h1>${esc(app.companyName)}</h1>
<p class="meta">${esc(t(`applications.status.${app.status}`))} · ${esc(t("applications.detail.submitted"))} ${esc(date(app.submittedAt))}${app.decidedAt ? ` · ${esc(t("applications.print.decided", { date: date(app.decidedAt) }))}` : ""}</p>
<table><tr><th>${esc(label("email"))}</th><td>${esc(app.email)}</td></tr>${rows}
<tr><th>${esc(t("applications.section.tax"))}</th><td dir="ltr">${esc(masked)} (${esc(t(`applications.taxCheck.${app.taxCheck}`))}${app.taxCheckName ? `: ${esc(app.taxCheckName)}` : ""})</td></tr></table>
<h2>${esc(t("applications.print.files"))}</h2>${fileRows ? `<ul>${fileRows}</ul>` : `<p>${esc(t("applications.certificate.missing"))}</p>`}
<p class="meta">${esc(t("applications.print.footer", { date: date(new Date()) }))}</p></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
};
