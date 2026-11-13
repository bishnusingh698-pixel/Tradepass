// Downloads and file views in the embedded admin. A plain link or a new tab
// carries no session token, so it lands on the login redirect instead of the
// file. App Bridge adds the token to fetch() calls to our own app, so we fetch
// and hand the browser a blob instead.

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Save text (e.g. CSV built by an action) as a file. */
export function saveText(text: string, filename: string, type = "text/csv;charset=utf-8") {
  saveBlob(new Blob([text], { type }), filename);
}

/** Fetch an app URL with the session token and save the response as a file. Resolves false on failure. */
export async function downloadFromApp(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    saveBlob(await res.blob(), filename);
    return true;
  } catch {
    return false;
  }
}

/** Open an app-served file (PDF, image) in a new tab. Resolves false on failure. */
export async function openFromApp(url: string): Promise<boolean> {
  // Opened before the fetch, so the browser treats it as the click's own popup.
  const win = window.open("", "_blank");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blobUrl = URL.createObjectURL(await res.blob());
    if (win) win.location.replace(blobUrl);
    else window.open(blobUrl, "_blank");
    return true;
  } catch {
    win?.close();
    return false;
  }
}
