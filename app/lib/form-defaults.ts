// Application form definition (feature spec §D). Built-in labels/help for the
// standard fields come from the theme extension's locale files
// (`form.field.<id>.label` etc.), so every field shows in the applicant's
// language; `texts` holds merchant overrides per locale. Custom fields carry
// their own texts. The same JSON drives the storefront renderer
// (extensions/tradepass-theme/assets/tradepass-form.js) and the admin preview.

export type FieldType =
  | "text" | "textarea" | "number" | "email" | "phone" | "url" | "select"
  | "checkboxes" | "date" | "file" | "address" | "country_tax" | "consent";

export type FieldTexts = { label?: string; placeholder?: string; help?: string };

export type FormField = {
  id: string; // standard ids are fixed (companyName, email, …); custom fields use "custom_<n>"
  type: FieldType;
  state: "required" | "optional" | "hidden";
  custom?: boolean;
  options?: { value: string; texts?: Record<string, string> }[]; // select / checkboxes
  showIf?: { field: string; equals: string };
  texts?: Record<string, FieldTexts>; // locale → merchant override
};

export type FormSection = { id: string; texts?: Record<string, { title?: string }>; fields: FormField[] };

export type FormDefinition = {
  version: 1;
  sections: FormSection[];
  consent: { texts: Record<string, string>; privacyUrl: string | null };
  success: { texts: Record<string, string>; redirectUrl: string | null };
  spamQuestion: { enabled: boolean; texts: Record<string, { question: string; answer: string }> };
};

const f = (id: string, type: FieldType, state: FormField["state"] = "optional", extra: Partial<FormField> = {}): FormField => ({
  id, type, state, ...extra,
});

const opts = (...values: string[]) => values.map((value) => ({ value }));

/** Store type options for the "storeType" question. */
export const STORE_TYPES = ["physical", "online", "both"] as const;

export const BUSINESS_TYPES = ["retail", "salon", "restaurant", "distributor", "reseller", "nonprofit", "other"] as const;

export function defaultFormDefinition(): FormDefinition {
  return {
    version: 1,
    sections: [
      {
        id: "business",
        fields: [
          f("companyName", "text", "required"),
          f("businessType", "select", "required", { options: opts(...BUSINESS_TYPES) }),
          f("website", "url"),
          f("yearEstablished", "number", "hidden"),
          f("locationsCount", "number", "hidden"),
          f("monthlyOrderValue", "select", "optional", { options: opts("lt1k", "1k-5k", "5k-20k", "gt20k") }),
          f("referral", "text", "hidden"),
          // US wholesale questions (hidden unless a template or the merchant turns them on).
          f("storeType", "select", "hidden", { options: opts(...STORE_TYPES) }),
          f("storeUrl", "url", "hidden"),
          f("yearsInBusiness", "number", "hidden"),
          f("ein", "text", "hidden"),
          f("duns", "text", "hidden"),
          f("tradeReferences", "textarea", "hidden"),
        ],
      },
      {
        id: "contact",
        fields: [
          f("firstName", "text", "required"),
          f("lastName", "text", "required"),
          f("email", "email", "required"),
          f("phone", "phone"),
          f("jobTitle", "text", "hidden"),
          f("preferredLanguage", "select", "optional"),
        ],
      },
      { id: "addresses", fields: [f("billingAddress", "address", "required"), f("shippingAddress", "address")] },
      { id: "tax", fields: [f("taxNumber", "country_tax"), f("certificates", "file")] },
      { id: "message", fields: [f("message", "textarea")] },
      { id: "consent", fields: [f("consent", "consent", "required")] },
    ],
    consent: { texts: {}, privacyUrl: null },
    success: { texts: {}, redirectUrl: null },
    spamQuestion: { enabled: false, texts: {} },
  };
}

/**
 * Ready-made form templates by business type. Each template only changes which
 * standard questions are asked and which are required; the merchant's own
 * questions, texts and consent stay as they are. Core fields (company, email,
 * names, billing address, consent) are always required and never touched.
 */
export const FORM_TEMPLATES = ["retail", "us_retail", "distributor", "salon", "restaurant", "reseller", "nonprofit", "other"] as const;
export type FormTemplate = (typeof FORM_TEMPLATES)[number];

const TEMPLATE_STATES: Record<FormTemplate, Partial<Record<string, FormField["state"]>>> = {
  // Shops buying to resell in-store: tax registration matters, a website is common but not universal.
  retail: { taxNumber: "required", website: "optional", locationsCount: "optional", monthlyOrderValue: "optional", certificates: "optional", phone: "optional" },
  // Distributors: established businesses with volume, so ask for history and expected spend.
  distributor: { taxNumber: "required", website: "required", yearEstablished: "optional", locationsCount: "optional", monthlyOrderValue: "required", certificates: "optional", phone: "required" },
  // Salons and spas: a professional licence is the usual proof; most order by phone.
  salon: { certificates: "required", phone: "required", website: "optional", locationsCount: "optional", taxNumber: "optional" },
  // Restaurants and cafés: deliveries to a different address, several sites, phone contact.
  restaurant: { phone: "required", locationsCount: "optional", shippingAddress: "optional", monthlyOrderValue: "optional", taxNumber: "optional" },
  // Online and marketplace resellers: tax number plus a resale certificate, and where they sell.
  reseller: { taxNumber: "required", certificates: "required", website: "required", referral: "optional", monthlyOrderValue: "optional" },
  // US retailers: resale certificate per state, EIN, how long in business, trade references, where they sell.
  us_retail: {
    taxNumber: "required", certificates: "required", phone: "required", ein: "optional", yearsInBusiness: "optional", duns: "optional",
    tradeReferences: "optional", storeType: "required", storeUrl: "optional", referral: "optional", website: "optional", monthlyOrderValue: "optional",
  },
  // Nonprofits buying tax-exempt: the exemption certificate and the EIN (checked on the IRS site).
  nonprofit: { taxNumber: "optional", certificates: "required", ein: "required", phone: "optional", website: "optional", referral: "optional" },
  other: {},
};

/**
 * Forms saved before a standard question existed get it back as hidden, at the end of its
 * section, so the builder can turn it on and templates can use it. Nothing visible changes.
 */
export function withAllStandardFields(def: FormDefinition): FormDefinition {
  const have = new Set(def.sections.flatMap((s) => s.fields.map((x) => x.id)));
  const base = defaultFormDefinition();
  const sections = def.sections.map((s) => {
    const missing = (base.sections.find((b) => b.id === s.id)?.fields ?? []).filter((x) => !have.has(x.id));
    return missing.length ? { ...s, fields: [...s.fields, ...missing.map((x) => ({ ...x, state: "hidden" as const }))] } : s;
  });
  return { ...def, sections };
}

/** Apply a template's question states to an existing form (custom questions and texts are kept). */
export function applyTemplate(input: FormDefinition, template: string): FormDefinition {
  const def = withAllStandardFields(input);
  const base = defaultFormDefinition();
  const states: Record<string, FormField["state"]> = {};
  for (const s of base.sections) for (const fl of s.fields) states[fl.id] = fl.state;
  Object.assign(states, TEMPLATE_STATES[(FORM_TEMPLATES as readonly string[]).includes(template) ? (template as FormTemplate) : "other"]);
  return {
    ...def,
    sections: def.sections.map((s) => ({
      ...s,
      fields: s.fields.map((fl) => (fl.custom || !(fl.id in states) ? fl : { ...fl, state: states[fl.id] })),
    })),
  };
}

/** Welcome / setup-wizard presets: a fresh default form with the business type's template applied. */
export function formForAudience(audience: string): FormDefinition {
  return applyTemplate(defaultFormDefinition(), audience);
}

export const SUGGESTED_TIER_NAMES: Record<string, string[]> = {
  retail: ["Retailer", "Key account"],
  salon: ["Professional", "Salon partner"],
  restaurant: ["Restaurant", "Group account"],
  distributor: ["Distributor", "Retailer"],
  reseller: ["Reseller", "Top reseller"],
  us_retail: ["Retailer", "Key account"],
  nonprofit: ["Nonprofit", "Partner"],
  other: ["Wholesale", "Volume"],
};
