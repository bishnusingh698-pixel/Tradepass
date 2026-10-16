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

export const BUSINESS_TYPES = ["retail", "salon", "restaurant", "distributor", "other"] as const;

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

/** Welcome-question presets (spec §B.1): sensible field states per audience. */
export function formForAudience(audience: string): FormDefinition {
  const def = defaultFormDefinition();
  const set = (id: string, state: FormField["state"]) => {
    for (const s of def.sections) for (const fl of s.fields) if (fl.id === id) fl.state = state;
  };
  if (audience === "salon") set("certificates", "required");
  if (audience === "retail") { set("taxNumber", "required"); set("website", "required"); }
  if (audience === "restaurant") set("locationsCount", "optional");
  if (audience === "distributor") { set("yearEstablished", "optional"); set("locationsCount", "optional"); set("monthlyOrderValue", "required"); }
  return def;
}

export const SUGGESTED_TIER_NAMES: Record<string, string[]> = {
  retail: ["Retailer", "Key account"],
  salon: ["Professional", "Salon partner"],
  restaurant: ["Restaurant", "Group account"],
  distributor: ["Distributor", "Retailer"],
  other: ["Wholesale", "Volume"],
};
