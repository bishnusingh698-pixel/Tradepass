// Shell for the standalone hosted pages behind the app proxy (more-info update, applicant status).
// Plain HTML, never Liquid, so nothing an applicant typed can run as Liquid; no-store, noindex,
// no referrer; dark mode and right-to-left supported.

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** JSON inside <script>: no "</script>" break-out, no HTML comments. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function page(opts: { lang: string; dir: string; title: string; body: string; head?: string; status?: number }) {
  const html = `<!doctype html>
<html lang="${esc(opts.lang)}" dir="${opts.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(opts.title)}</title>
<style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;color:#1a1a1a;background:#fff}
.hosted{max-inline-size:40rem;margin-inline:auto;padding:2rem 1rem 4rem}
h1{font-size:1.5rem;line-height:1.3;margin-block:0 1rem}
.msg{padding:1rem;border:1px solid #c9cccf;border-radius:4px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg-label{font-weight:600;margin-block-end:.25rem}
.tpf-submit{background:#1a1a1a;color:#fff;border:0;border-radius:4px}
.btn{display:inline-flex;align-items:center;min-block-size:44px;padding-inline:1rem;border:1px solid currentColor;border-radius:4px;color:inherit;text-decoration:none;font-weight:600}
.btn-primary{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
a{color:#005bd3}
@media (prefers-color-scheme:dark){body{background:#111;color:#f1f1f1}.tpf-submit,.btn-primary{background:#f1f1f1;color:#111;border-color:#f1f1f1}
a{color:#8ab4f8}.hosted .tpf-error,.hosted .tpf-summary a{color:#ff8a80}.hosted .tpf-summary,.hosted .tpf [aria-invalid=true]{border-color:#ff8a80}.msg{border-color:#5c5f62}}
</style>
${opts.head ?? ""}
</head>
<body><main class="hosted">${opts.body}</main></body>
</html>`;
  return new Response(html, {
    status: opts.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
