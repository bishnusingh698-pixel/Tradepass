// Merchant-editable saved replies (feature B9): rejection reasons and "more info" messages in the
// merchant's own words, per language, in the merchant's order. Used by the reject and "more info"
// dialogs, bulk reject and auto-reject rules. Client-safe.
import { MAX_REPLIES, type SavedReply } from "./settings";

export type ReplyKind = "reject" | "info";
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export const REPLY_LIMITS = { title: 80, text: 2000 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Rebuild the replies the editor posted: known shape only, limits applied, empty replies dropped. */
export function sanitizeReplies(raw: unknown): { reject: SavedReply[]; info: SavedReply[] } {
  const one = (list: unknown): SavedReply[] => {
    const out: SavedReply[] = [];
    const seen = new Set<string>();
    for (const r of (Array.isArray(list) ? list : []).slice(0, MAX_REPLIES)) {
      if (!isObj(r)) continue;
      let id = typeof r.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(r.id) ? r.id : "";
      while (!id || seen.has(id)) id = `r${Math.random().toString(36).slice(2, 10)}`;
      const texts: SavedReply["texts"] = {};
      for (const [loc, v] of Object.entries(isObj(r.texts) ? r.texts : {})) {
        if (!LOCALE_RE.test(loc) || !isObj(v)) continue;
        const title = typeof v.title === "string" ? v.title.trim().slice(0, REPLY_LIMITS.title) : "";
        const text = typeof v.text === "string" ? v.text.trim().slice(0, REPLY_LIMITS.text) : "";
        if (text) texts[loc] = { title: title || text.slice(0, 40), text };
      }
      if (!Object.keys(texts).length) continue;
      seen.add(id);
      out.push({ id, texts });
    }
    return out;
  };
  const r = isObj(raw) ? raw : {};
  return { reject: one(r.reject), info: one(r.info) };
}

/** The reply in a language: exact, base language, the store's primary language, English, then any. */
export function replyIn(reply: SavedReply, locale: string | null | undefined, primary = "en"): { title: string; text: string } | null {
  const t = reply.texts;
  const base = (locale ?? "").split("-")[0];
  return (locale && t[locale]) || (base && t[base]) || t[primary] || t[primary.split("-")[0]] || t.en || Object.values(t)[0] || null;
}
