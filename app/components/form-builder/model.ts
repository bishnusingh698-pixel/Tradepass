// Pure helpers for the form builder, shared by the admin page (client) and
// forms.server.ts (server), so the merchant sees the same errors before and
// after saving. No DB or Shopify calls here.
import type { FieldType, FormDefinition, FormField, FormSection, FieldTexts } from "../../lib/form-defaults";

/** Standard fields that every application needs; they can't be hidden or removed. */
export const LOCKED_FIELDS = ["companyName", "email", "firstName", "lastName", "billingAddress", "consent"] as const;

export const STANDARD_FIELDS: Record<string, FieldType> = {
  companyName: "text", businessType: "select", website: "url", yearEstablished: "number",
  locationsCount: "number", monthlyOrderValue: "select", referral: "text",
  firstName: "text", lastName: "text", email: "email", phone: "phone", jobTitle: "text", preferredLanguage: "select",
  billingAddress: "address", shippingAddress: "address", taxNumber: "country_tax", certificates: "file",
  message: "textarea", consent: "consent",
};

export const CUSTOM_FIELD_TYPES: FieldType[] = [
  "text", "textarea", "number", "email", "phone", "url", "select", "checkboxes", "date", "file",
];

/** Field types whose answer is one of a fixed list, so they can drive "show if". */
export const CHOICE_TYPES: FieldType[] = ["select", "checkboxes"];

export const LIMITS = { label: 200, placeholder: 200, help: 500, option: 120, consent: 2000, success: 2000, spam: 200, options: 50, fields: 60, url: 2000, formName: 80 };

export const CUSTOM_ID = /^custom_[0-9]{1,6}$/;
const OPTION_VALUE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

export const isLocked = (id: string) => (LOCKED_FIELDS as readonly string[]).includes(id);

export type FormErrorCode =
  | "invalid" | "lockedHidden" | "lockedMissing" | "duplicateId" | "badCustomId" | "badType"
  | "labelRequired" | "tooLong" | "optionsRequired" | "badOptionValue" | "duplicateOption" | "tooManyOptions"
  | "showIfMissing" | "showIfSelf" | "showIfNotChoice" | "showIfBadValue" | "showIfHidden" | "showIfOrder"
  | "badUrl" | "spamIncomplete" | "tooManyFields" | "nameRequired";

/** `anchor` is the DOM id of the input to focus from the error summary. */
export type FormError = { code: FormErrorCode; anchor: string; fieldId?: string; values?: Record<string, string | number> };

export const fieldAnchor = (fieldId: string, part = "row") => `fb-${fieldId}-${part}`;

/** Accepts absolute http(s) URLs and store-relative paths ("/pages/privacy"). */
export function isSafeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.length > LIMITS.url) return false;
  if (v.startsWith("/") && !v.startsWith("//")) return !/[\s<>"]/.test(v);
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function allFields(def: FormDefinition): FormField[] {
  return def.sections.flatMap((s) => s.fields);
}

export function findField(def: FormDefinition, id: string): FormField | undefined {
  return allFields(def).find((f) => f.id === id);
}

/** Next free custom id: custom_<max+1>, never reusing an id (old answers stay meaningful). */
export function nextCustomId(def: FormDefinition): string {
  let max = 0;
  for (const f of allFields(def)) {
    const m = CUSTOM_ID.exec(f.id);
    if (m) max = Math.max(max, Number(f.id.slice(7)));
  }
  return `custom_${max + 1}`;
}

/** Turn an option label into a stable value ("Hair salon" → "hair-salon"), unique within the field. */
export function optionValueFrom(label: string, taken: string[]): string {
  const base = label.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "option";
  let v = base;
  for (let i = 2; taken.includes(v); i++) v = `${base}-${i}`;
  return v;
}

/** Move a field up/down within the flat order; crossing a section edge moves it into the neighbour section. */
export function moveField(def: FormDefinition, fieldId: string, delta: -1 | 1): FormDefinition {
  const next = structuredClone(def);
  const si = next.sections.findIndex((s) => s.fields.some((f) => f.id === fieldId));
  if (si < 0) return def;
  const fields = next.sections[si].fields;
  const fi = fields.findIndex((f) => f.id === fieldId);
  const target = fi + delta;
  if (target >= 0 && target < fields.length) {
    [fields[fi], fields[target]] = [fields[target], fields[fi]];
    return next;
  }
  const ns = si + delta;
  if (ns < 0 || ns >= next.sections.length) return def;
  const [field] = fields.splice(fi, 1);
  if (delta < 0) next.sections[ns].fields.push(field);
  else next.sections[ns].fields.unshift(field);
  return next;
}

/** Drag and drop: put `fieldId` before `beforeId` (or at the end of `sectionId` when beforeId is null). */
export function placeField(def: FormDefinition, fieldId: string, sectionId: string, beforeId: string | null): FormDefinition {
  if (fieldId === beforeId) return def;
  const next = structuredClone(def);
  let moving: FormField | undefined;
  for (const s of next.sections) {
    const i = s.fields.findIndex((f) => f.id === fieldId);
    if (i >= 0) [moving] = s.fields.splice(i, 1);
  }
  const section = next.sections.find((s) => s.id === sectionId);
  if (!moving || !section) return def;
  const at = beforeId ? section.fields.findIndex((f) => f.id === beforeId) : -1;
  if (at < 0) section.fields.push(moving);
  else section.fields.splice(at, 0, moving);
  return next;
}

export function moveSection(def: FormDefinition, sectionId: string, delta: -1 | 1): FormDefinition {
  const i = def.sections.findIndex((s) => s.id === sectionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= def.sections.length) return def;
  const next = structuredClone(def);
  [next.sections[i], next.sections[j]] = [next.sections[j], next.sections[i]];
  return next;
}

/** Removing a custom field also clears every "show if" that pointed at it. */
export function removeField(def: FormDefinition, fieldId: string): FormDefinition {
  const field = findField(def, fieldId);
  if (!field?.custom) return def;
  const next = structuredClone(def);
  for (const s of next.sections) {
    s.fields = s.fields.filter((f) => f.id !== fieldId);
    for (const f of s.fields) if (f.showIf?.field === fieldId) delete f.showIf;
  }
  return next;
}

// ---- validation and sanitising -------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const LOCALE_KEY = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

function cleanTextMap<T extends Record<string, string>>(v: unknown, keys: (keyof T)[]): Record<string, Partial<T>> {
  const out: Record<string, Partial<T>> = {};
  if (!isObj(v)) return out;
  for (const [loc, texts] of Object.entries(v)) {
    if (!LOCALE_KEY.test(loc) || !isObj(texts)) continue;
    const entry: Partial<T> = {};
    for (const k of keys) {
      const s = str(texts[k as string]).trim();
      if (s) entry[k] = s as T[keyof T];
    }
    if (Object.keys(entry).length) out[loc] = entry;
  }
  return out;
}

function cleanStringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [loc, s] of Object.entries(v)) {
    const t = str(s).trim();
    if (LOCALE_KEY.test(loc) && t) out[loc] = t;
  }
  return out;
}

/**
 * Rebuild a FormDefinition from untrusted JSON, keeping only known keys and
 * trimmed strings. Returns null if the basic shape is wrong.
 */
export function sanitizeDefinition(input: unknown): FormDefinition | null {
  if (!isObj(input) || !Array.isArray(input.sections)) return null;
  const sections: FormSection[] = [];
  for (const s of input.sections) {
    if (!isObj(s) || typeof s.id !== "string" || !Array.isArray(s.fields)) return null;
    const fields: FormField[] = [];
    for (const f of s.fields) {
      if (!isObj(f) || typeof f.id !== "string" || typeof f.type !== "string") return null;
      const field: FormField = {
        id: f.id,
        type: f.type as FieldType,
        state: f.state === "required" || f.state === "hidden" ? f.state : "optional",
      };
      if (f.custom === true) field.custom = true;
      if (Array.isArray(f.options)) {
        field.options = f.options.filter(isObj).map((o) => {
          const opt: NonNullable<FormField["options"]>[number] = { value: str(o.value).trim() };
          const texts = cleanStringMap(o.texts);
          if (Object.keys(texts).length) opt.texts = texts;
          return opt;
        });
      }
      if (isObj(f.showIf) && typeof f.showIf.field === "string" && f.showIf.field) {
        field.showIf = { field: f.showIf.field, equals: str(f.showIf.equals) };
      }
      const texts = cleanTextMap<Required<FieldTexts>>(f.texts, ["label", "placeholder", "help"]);
      if (Object.keys(texts).length) field.texts = texts;
      fields.push(field);
    }
    const section: FormSection = { id: s.id, fields };
    const titles = cleanTextMap<{ title: string }>(s.texts, ["title"]);
    if (Object.keys(titles).length) section.texts = titles;
    sections.push(section);
  }
  const consent = isObj(input.consent) ? input.consent : {};
  const success = isObj(input.success) ? input.success : {};
  const spam = isObj(input.spamQuestion) ? input.spamQuestion : {};
  const urlOrNull = (v: unknown) => (str(v).trim() ? str(v).trim() : null);
  return {
    version: 1,
    sections,
    consent: { texts: cleanStringMap(consent.texts), privacyUrl: urlOrNull(consent.privacyUrl) },
    success: { texts: cleanStringMap(success.texts), redirectUrl: urlOrNull(success.redirectUrl) },
    spamQuestion: {
      enabled: spam.enabled === true,
      texts: cleanTextMap<{ question: string; answer: string }>(spam.texts, ["question", "answer"]) as FormDefinition["spamQuestion"]["texts"],
    },
  };
}

/** Every rule the builder enforces. Empty array = valid. */
export function validateDefinition(def: FormDefinition): FormError[] {
  const errors: FormError[] = [];
  const fields = allFields(def);
  const order = new Map(fields.map((f, i) => [f.id, i]));
  const seen = new Set<string>();

  if (fields.length > LIMITS.fields) errors.push({ code: "tooManyFields", anchor: "fb-add-field", values: { max: LIMITS.fields } });

  for (const id of LOCKED_FIELDS) {
    if (!order.has(id)) errors.push({ code: "lockedMissing", anchor: "fb-sections", fieldId: id });
  }

  for (const f of fields) {
    const anchor = fieldAnchor(f.id);
    if (seen.has(f.id)) errors.push({ code: "duplicateId", anchor, fieldId: f.id });
    seen.add(f.id);

    if (f.custom) {
      if (!CUSTOM_ID.test(f.id)) errors.push({ code: "badCustomId", anchor, fieldId: f.id });
      if (!CUSTOM_FIELD_TYPES.includes(f.type)) errors.push({ code: "badType", anchor, fieldId: f.id });
      // Custom fields have no built-in label, so at least one language needs one.
      if (!Object.values(f.texts ?? {}).some((t) => t.label?.trim())) {
        errors.push({ code: "labelRequired", anchor: fieldAnchor(f.id, "label"), fieldId: f.id });
      }
    } else if (STANDARD_FIELDS[f.id] !== f.type) {
      errors.push({ code: "badType", anchor, fieldId: f.id });
    }

    if (isLocked(f.id) && f.state === "hidden") errors.push({ code: "lockedHidden", anchor, fieldId: f.id });

    for (const t of Object.values(f.texts ?? {})) {
      if ((t.label?.length ?? 0) > LIMITS.label || (t.placeholder?.length ?? 0) > LIMITS.placeholder || (t.help?.length ?? 0) > LIMITS.help) {
        errors.push({ code: "tooLong", anchor: fieldAnchor(f.id, "label"), fieldId: f.id });
        break;
      }
    }

    if (CHOICE_TYPES.includes(f.type) && f.id !== "preferredLanguage") {
      const opts = f.options ?? [];
      if (opts.length === 0) errors.push({ code: "optionsRequired", anchor: fieldAnchor(f.id, "options"), fieldId: f.id });
      if (opts.length > LIMITS.options) errors.push({ code: "tooManyOptions", anchor: fieldAnchor(f.id, "options"), fieldId: f.id, values: { max: LIMITS.options } });
      const values = new Set<string>();
      for (const o of opts) {
        if (!OPTION_VALUE.test(o.value)) errors.push({ code: "badOptionValue", anchor: fieldAnchor(f.id, "options"), fieldId: f.id });
        else if (values.has(o.value)) errors.push({ code: "duplicateOption", anchor: fieldAnchor(f.id, "options"), fieldId: f.id });
        values.add(o.value);
        if (Object.values(o.texts ?? {}).some((s) => s.length > LIMITS.option)) {
          errors.push({ code: "tooLong", anchor: fieldAnchor(f.id, "options"), fieldId: f.id });
        }
      }
      if (f.custom && opts.length && !opts.every((o) => Object.values(o.texts ?? {}).some(Boolean))) {
        errors.push({ code: "labelRequired", anchor: fieldAnchor(f.id, "options"), fieldId: f.id });
      }
    }

    if (f.showIf) {
      const a = fieldAnchor(f.id, "showif");
      const dep = fields.find((x) => x.id === f.showIf!.field);
      if (!dep) errors.push({ code: "showIfMissing", anchor: a, fieldId: f.id });
      else if (dep.id === f.id) errors.push({ code: "showIfSelf", anchor: a, fieldId: f.id });
      else if (!CHOICE_TYPES.includes(dep.type) || !dep.options?.length) errors.push({ code: "showIfNotChoice", anchor: a, fieldId: f.id });
      else if (!dep.options.some((o) => o.value === f.showIf!.equals)) errors.push({ code: "showIfBadValue", anchor: a, fieldId: f.id });
      else if (dep.state === "hidden") errors.push({ code: "showIfHidden", anchor: a, fieldId: f.id });
      // Depending on a later field would make the form jump around while filling it in.
      else if ((order.get(dep.id) ?? 0) > (order.get(f.id) ?? 0)) errors.push({ code: "showIfOrder", anchor: a, fieldId: f.id });
      if (f.showIf && isLocked(f.id)) errors.push({ code: "lockedHidden", anchor: a, fieldId: f.id });
    }
  }

  if (def.consent.privacyUrl && !isSafeUrl(def.consent.privacyUrl)) errors.push({ code: "badUrl", anchor: "fb-privacy-url" });
  if (Object.values(def.consent.texts).some((s) => s.length > LIMITS.consent)) errors.push({ code: "tooLong", anchor: "fb-consent-text" });
  if (def.success.redirectUrl && !isSafeUrl(def.success.redirectUrl)) errors.push({ code: "badUrl", anchor: "fb-redirect-url" });
  if (Object.values(def.success.texts).some((s) => s.length > LIMITS.success)) errors.push({ code: "tooLong", anchor: "fb-success-text" });
  if (def.spamQuestion.enabled) {
    const complete = Object.values(def.spamQuestion.texts).some((t) => t.question?.trim() && t.answer?.trim());
    if (!complete) errors.push({ code: "spamIncomplete", anchor: "fb-spam-question" });
    if (Object.values(def.spamQuestion.texts).some((t) => (t.question?.length ?? 0) > LIMITS.spam || (t.answer?.length ?? 0) > LIMITS.spam)) {
      errors.push({ code: "tooLong", anchor: "fb-spam-question" });
    }
  }
  return errors;
}

/** Set one text of a field for one language; empty text removes the override (falls back to the built-in). */
export function setFieldText(def: FormDefinition, fieldId: string, locale: string, key: keyof FieldTexts, value: string): FormDefinition {
  const next = structuredClone(def);
  const f = findField(next, fieldId);
  if (!f) return def;
  const texts = (f.texts ??= {});
  const entry = (texts[locale] ??= {});
  if (value) entry[key] = value;
  else delete entry[key];
  if (!Object.keys(entry).length) delete texts[locale];
  if (!Object.keys(texts).length) delete f.texts;
  return next;
}

export function updateField(def: FormDefinition, fieldId: string, patch: Partial<FormField>): FormDefinition {
  const next = structuredClone(def);
  const f = findField(next, fieldId);
  if (!f) return def;
  Object.assign(f, patch);
  for (const k of Object.keys(patch) as (keyof FormField)[]) if (patch[k] === undefined) delete f[k];
  return next;
}
