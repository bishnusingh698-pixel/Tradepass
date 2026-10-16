import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer";

// Pseudo-localization for overflow testing: accents every letter and pads
// each literal by ~40% (the expansion of de/fi/el/hu/ru), keeping ICU intact.
const MAP: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú",
  c: "ç", n: "ñ", s: "š", y: "ý", z: "ž", C: "Ç", N: "Ñ", S: "Š", Y: "Ý", Z: "Ž",
};

function transform(els: MessageFormatElement[]): MessageFormatElement[] {
  return els.map((el) => {
    if (el.type === TYPE.literal) {
      const accented = el.value.replace(/[a-zA-Z]/g, (ch) => MAP[ch] ?? ch);
      const pad = "~".repeat(Math.ceil(el.value.trim().length * 0.4));
      return { ...el, value: el.value.trim() ? `${accented}${pad}` : accented };
    }
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      const options = Object.fromEntries(
        Object.entries(el.options).map(([k, v]) => [k, { ...v, value: transform(v.value) }]),
      );
      return { ...el, options };
    }
    if (el.type === TYPE.tag) return { ...el, children: transform(el.children) };
    return el;
  });
}

export function pseudoLocalize(message: string): string {
  return `⟦${printAST(transform(parse(message)))}⟧`;
}
