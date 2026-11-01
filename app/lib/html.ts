// Small helpers for the server-rendered hosted pages (certificate renewal).

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const BASE_FONTS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"`;
const SCRIPT_FONTS: Record<string, string> = {
  ar: `"Segoe UI", Tahoma, "Geeza Pro", "Noto Sans Arabic", "Noto Naskh Arabic"`,
  ur: `"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Segoe UI", Tahoma, "Noto Sans Arabic"`,
  he: `"Segoe UI", Arial, "Noto Sans Hebrew"`,
  hi: `"Nirmala UI", "Kohinoor Devanagari", "Noto Sans Devanagari", Mangal`,
  th: `"Leelawadee UI", Thonburi, "Noto Sans Thai", Tahoma`,
  zh: `"PingFang SC", "PingFang TC", "Microsoft YaHei", "Microsoft JhengHei", "Noto Sans CJK SC", "Noto Sans SC"`,
  ja: `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Noto Sans JP"`,
  ko: `"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR"`,
};

/** System font stack for a language: script-specific fonts first, then the Latin stack, then sans-serif. */
export function fontStack(locale: string): string {
  const script = SCRIPT_FONTS[locale.split("-")[0]];
  return `${script ? `${script}, ` : ""}${BASE_FONTS}, sans-serif`;
}
