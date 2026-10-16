import { afterAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { defaultFormDefinition, type FormDefinition, type FormField } from "../app/lib/form-defaults";
import {
  LOCKED_FIELDS, moveField, nextCustomId, optionValueFrom, placeField, removeField, sanitizeDefinition, setFieldText, validateDefinition,
} from "../app/components/form-builder/model";
import { checkFormInput, createForm, deleteForm, getForm, getShopLocales, saveForm, setDefaultForm } from "../app/lib/forms.server";

const shop = `test-form-admin-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;

afterAll(async () => {
  await db.form.deleteMany({ where: { shop } });
  await db.tier.deleteMany({ where: { shop } });
});

const codes = (def: FormDefinition) => validateDefinition(def).map((e) => `${e.code}:${e.fieldId ?? e.anchor}`);
const field = (def: FormDefinition, id: string) => def.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
const withCustom = (def: FormDefinition, f: Partial<FormField> & { id: string }, section = "business") => {
  def.sections.find((s) => s.id === section)!.fields.push({ type: "text", state: "optional", custom: true, ...f } as FormField);
  return def;
};

describe("form definition validation", () => {
  it("accepts the default form", () => {
    expect(validateDefinition(defaultFormDefinition())).toEqual([]);
  });

  it("never lets the six essential fields be hidden or removed", () => {
    for (const id of LOCKED_FIELDS) {
      const def = defaultFormDefinition();
      field(def, id).state = "hidden";
      expect(codes(def)).toContain(`lockedHidden:${id}`);
      const removed = defaultFormDefinition();
      for (const s of removed.sections) s.fields = s.fields.filter((f) => f.id !== id);
      expect(codes(removed)).toContain(`lockedMissing:${id}`);
    }
  });

  it("lets other standard fields be hidden or required", () => {
    const def = defaultFormDefinition();
    field(def, "website").state = "hidden";
    field(def, "taxNumber").state = "required";
    expect(validateDefinition(def)).toEqual([]);
  });

  it("checks custom field ids, types and labels", () => {
    expect(codes(withCustom(defaultFormDefinition(), { id: "custom_1", texts: { en: { label: "Licence" } } }))).toEqual([]);
    expect(codes(withCustom(defaultFormDefinition(), { id: "evil<script>", texts: { en: { label: "x" } } }))).toContain("badCustomId:evil<script>");
    expect(codes(withCustom(defaultFormDefinition(), { id: "custom_2", type: "address", texts: { en: { label: "x" } } }))).toContain("badType:custom_2");
    expect(codes(withCustom(defaultFormDefinition(), { id: "custom_3" }))).toContain("labelRequired:custom_3");
    const dup = withCustom(withCustom(defaultFormDefinition(), { id: "custom_4", texts: { en: { label: "a" } } }), { id: "custom_4", texts: { en: { label: "b" } } });
    expect(codes(dup)).toContain("duplicateId:custom_4");
    // A standard id can't be reused with another type.
    const def = defaultFormDefinition();
    field(def, "website").type = "file";
    expect(codes(def)).toContain("badType:website");
  });

  it("requires options with valid, unique values on choice fields", () => {
    const base = () => withCustom(defaultFormDefinition(), { id: "custom_1", type: "select", texts: { en: { label: "Size" } } });
    expect(codes(base())).toContain("optionsRequired:custom_1");
    const ok = base();
    field(ok, "custom_1").options = [{ value: "small", texts: { en: "Small" } }, { value: "large", texts: { en: "Large" } }];
    expect(codes(ok)).toEqual([]);
    const dup = base();
    field(dup, "custom_1").options = [{ value: "a", texts: { en: "A" } }, { value: "a", texts: { en: "A again" } }];
    expect(codes(dup)).toContain("duplicateOption:custom_1");
    const bad = base();
    field(bad, "custom_1").options = [{ value: "Has Spaces", texts: { en: "x" } }];
    expect(codes(bad)).toContain("badOptionValue:custom_1");
    const unlabeled = base();
    field(unlabeled, "custom_1").options = [{ value: "a" }];
    expect(codes(unlabeled)).toContain("labelRequired:custom_1");
  });

  it("checks conditional logic references an existing, earlier, visible choice field and a real answer", () => {
    const def = () => withCustom(defaultFormDefinition(), { id: "custom_1", texts: { en: { label: "Salon licence" } } }, "tax");
    const ok = def();
    field(ok, "custom_1").showIf = { field: "businessType", equals: "salon" };
    expect(codes(ok)).toEqual([]);

    const missing = def();
    field(missing, "custom_1").showIf = { field: "custom_99", equals: "x" };
    expect(codes(missing)).toContain("showIfMissing:custom_1");

    const self = def();
    field(self, "custom_1").showIf = { field: "custom_1", equals: "x" };
    expect(codes(self)).toContain("showIfSelf:custom_1");

    const notChoice = def();
    field(notChoice, "custom_1").showIf = { field: "companyName", equals: "x" };
    expect(codes(notChoice)).toContain("showIfNotChoice:custom_1");

    const badValue = def();
    field(badValue, "custom_1").showIf = { field: "businessType", equals: "spaceship" };
    expect(codes(badValue)).toContain("showIfBadValue:custom_1");

    const hidden = def();
    field(hidden, "custom_1").showIf = { field: "monthlyOrderValue", equals: "lt1k" };
    field(hidden, "monthlyOrderValue").state = "hidden";
    expect(codes(hidden)).toContain("showIfHidden:custom_1");

    const later = withCustom(defaultFormDefinition(), { id: "custom_1", texts: { en: { label: "x" } } }, "business");
    field(later, "custom_1").showIf = { field: "monthlyOrderValue", equals: "lt1k" };
    expect(codes(later)).toEqual([]);
    // Move it above its source: now invalid.
    const moved = placeField(later, "custom_1", "business", "companyName");
    expect(codes(moved)).toContain("showIfOrder:custom_1");

    const lockedConditional = defaultFormDefinition();
    field(lockedConditional, "email").showIf = { field: "businessType", equals: "salon" };
    expect(codes(lockedConditional)).toContain("lockedHidden:email");
  });

  it("checks URLs and the spam question", () => {
    const def = defaultFormDefinition();
    def.consent.privacyUrl = "javascript:alert(1)";
    def.success.redirectUrl = "//evil.example";
    def.spamQuestion.enabled = true;
    expect(codes(def)).toEqual(expect.arrayContaining(["badUrl:fb-privacy-url", "badUrl:fb-redirect-url", "spamIncomplete:fb-spam-question"]));
    def.consent.privacyUrl = "/policies/privacy-policy";
    def.success.redirectUrl = "https://example.com/thanks";
    def.spamQuestion.texts = { en: { question: "2 + 2?", answer: "4" } };
    expect(validateDefinition(def)).toEqual([]);
  });
});

describe("builder helpers", () => {
  it("allocates custom ids without reuse and makes option values", () => {
    const def = withCustom(withCustom(defaultFormDefinition(), { id: "custom_1" }), { id: "custom_7" });
    expect(nextCustomId(def)).toBe("custom_8");
    expect(nextCustomId(defaultFormDefinition())).toBe("custom_1");
    expect(optionValueFrom("Hair Salon", [])).toBe("hair-salon");
    expect(optionValueFrom("Hair Salon", ["hair-salon"])).toBe("hair-salon-2");
    expect(optionValueFrom("日本", [])).toBe("option");
  });

  it("moves fields within and across sections", () => {
    const def = defaultFormDefinition();
    const up = moveField(def, "businessType", -1);
    expect(up.sections[0].fields.map((f) => f.id).slice(0, 2)).toEqual(["businessType", "companyName"]);
    // First field of "contact" moving up lands at the end of "business".
    const across = moveField(def, "firstName", -1);
    expect(across.sections[0].fields.at(-1)!.id).toBe("firstName");
    expect(moveField(def, "companyName", -1)).toBe(def); // already first
    const placed = placeField(def, "message", "business", "website");
    expect(placed.sections[0].fields.map((f) => f.id)).toContain("message");
    expect(placed.sections.find((s) => s.id === "message")!.fields).toHaveLength(0);
  });

  it("removes only custom fields and clears conditions pointing at them", () => {
    const def = withCustom(withCustom(defaultFormDefinition(), { id: "custom_1", type: "select", options: [{ value: "a" }] }), { id: "custom_2", showIf: { field: "custom_1", equals: "a" } });
    const next = removeField(def, "custom_1");
    expect(field(next, "custom_2").showIf).toBeUndefined();
    expect(removeField(def, "email")).toBe(def);
  });

  it("stores per-language overrides and drops empty ones", () => {
    let def = setFieldText(defaultFormDefinition(), "companyName", "de", "label", "Firmenname");
    expect(field(def, "companyName").texts).toEqual({ de: { label: "Firmenname" } });
    def = setFieldText(def, "companyName", "de", "label", "");
    expect(field(def, "companyName").texts).toBeUndefined();
  });

  it("sanitises untrusted JSON: unknown keys dropped, bad shapes rejected", () => {
    const raw = JSON.parse(JSON.stringify(defaultFormDefinition()));
    raw.sections[0].fields[0].onclick = "x";
    raw.sections[0].fields[0].texts = { en: { label: "  Company  ", evil: "x" }, "../x": { label: "y" } };
    raw.extra = true;
    const clean = sanitizeDefinition(raw)!;
    expect(clean.sections[0].fields[0]).toEqual({ id: "companyName", type: "text", state: "required", texts: { en: { label: "Company" } } });
    expect("extra" in clean).toBe(false);
    expect(sanitizeDefinition({ sections: "nope" })).toBeNull();
    expect(sanitizeDefinition(null)).toBeNull();
  });
});

describe("forms.server", () => {
  it("creates, saves, validates, defaults and deletes forms per shop and plan", async () => {
    const first = await createForm(shop, "free", "Wholesale application");
    expect("id" in first).toBe(true);
    // Free plan: a second form is Pro only.
    expect(await createForm(shop, "free", "Distributors")).toEqual({ error: "plan" });
    const second = await createForm(shop, "pro", "Distributors");
    if (!("id" in second) || !("id" in first)) throw new Error("create failed");
    expect(await createForm(shop, "pro", "   ")).toEqual({ error: "name" });

    const tier = await db.tier.create({ data: { shop, name: "Distributor" } });
    const def = withCustom(defaultFormDefinition(), { id: "custom_1", texts: { en: { label: "Licence" } }, showIf: { field: "businessType", equals: "salon" } }, "tax");
    const ok = await saveForm(shop, second.id, { name: "Distributors", suggestedTierId: tier.id, definition: def });
    expect(ok.ok).toBe(true);
    const loaded = await getForm(shop, second.id);
    expect(loaded?.suggestedTierId).toBe(tier.id);
    expect(field(loaded!.definition, "custom_1").showIf).toEqual({ field: "businessType", equals: "salon" });

    const bad = await saveForm(shop, second.id, { name: "", suggestedTierId: "not-a-tier", definition: { ...def, sections: def.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (f.id === "email" ? { ...f, state: "hidden" } : f)) })) } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["lockedHidden", "nameRequired", "invalid"]));

    // Another shop can't read or write this form.
    expect(await getForm("other-shop.myshopify.com", second.id)).toBeNull();
    expect((await saveForm("other-shop.myshopify.com", second.id, { name: "x", suggestedTierId: null, definition: def })).ok).toBe(false);
    expect((await checkFormInput("other-shop.myshopify.com", { name: "x", suggestedTierId: tier.id, definition: def })).ok).toBe(false);

    expect(await deleteForm(shop, first.id)).toBe(false); // default form stays
    expect(await setDefaultForm(shop, second.id)).toBe(true);
    expect(await db.form.count({ where: { shop, isDefault: true } })).toBe(1);
    expect(await deleteForm(shop, first.id)).toBe(true);
  });

  it("reads store languages, primary first, and survives API errors", async () => {
    const admin = {
      graphql: async () =>
        new Response(JSON.stringify({ data: { shopLocales: [{ locale: "en", primary: false, published: true }, { locale: "fr", primary: true, published: true }, { locale: "de", primary: false, published: false }] } })),
    };
    expect((await getShopLocales(admin)).map((l) => l.locale)).toEqual(["fr", "en", "de"]);
    const failing = { graphql: async () => new Response(JSON.stringify({ errors: [{ message: "Access denied" }] })) };
    expect(await getShopLocales(failing)).toEqual([]);
  });
});
