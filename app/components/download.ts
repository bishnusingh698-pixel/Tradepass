// Downloads and file views in the embedded admin. A plain <a href> (or a new
// tab) reaches our server without the App Bridge session token, so
// authenticate.admin turns it into a login redirect. `fetch` from inside the
// app gets the token added by App Bridge, so files are fetched and handed to
// the browser as blobs.

/** Fetch an app URL with the session token and save the response as `filename`. */
export async function downloadFrom(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  saveBlob(await res.blob(), filename);
}

/** Save text we already have (e.g. CSV returned by an action) as a file. */
export function saveText(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  saveBlob(new Blob([text], { type }), filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Open a certificate / application file (served by /app/files/:id) in a new tab. */
export async function openStaffFile(id: string, onError: () => void): Promise<void> {
  // Opened before the fetch so the browser treats it as the click's popup.
  const win = window.open("", "_blank");
  try {
    const res = await fetch(`/app/files/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.replace(url);
    else window.open(url, "_blank");
  } catch {
    win?.close();
    onError();
  }
}

/**
 * A date-only value ("2026-11-30", stored as UTC midnight) as a Date at local
 * midnight, so formatting it in the browser's time zone shows the same day.
 */
export function dateOnly(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
