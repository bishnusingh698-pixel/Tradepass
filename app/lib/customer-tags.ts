// Customer tags on approval (feature C19). Client-safe parsing; the Shopify calls live in
// approval.server.ts (tagsAdd / tagsRemove, validated against Admin 2026-10).

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;

/** "wholesale, b2b" → ["wholesale", "b2b"]; null when there are too many or one is too long. */
export function cleanTags(raw: string): string[] | null {
  const tags = [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
  if (tags.length > MAX_TAGS || tags.some((x) => x.length > MAX_TAG_LENGTH || /[<>]/.test(x))) return null;
  return tags;
}
