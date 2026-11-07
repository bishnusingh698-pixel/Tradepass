// QR codes made in the app for trade shows and catalogues (C17): no external service.
// qrcode-generator (MIT, Kazuhiko Arase) encodes; we draw a plain SVG with the standard quiet zone.
import qrcode from "qrcode-generator";

/** SVG of a QR code for `text` (error correction M, 4-module quiet zone), `size` px square. */
export function qrSvg(text: string, size = 512): string {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;
  const total = n + q * 2;
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** The form's address with tags, so applications from the printed code show up under "Where they came from". */
export function trackedUrl(base: string, source = "qr", medium = "print"): string {
  const u = new URL(base);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", medium);
  return u.toString();
}
