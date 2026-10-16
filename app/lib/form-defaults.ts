// Default application form (feature spec §D). Labels are message keys, not
// text, so every field shows in the applicant's language; merchants override
// per language in the form builder (P3).
export type FieldType =
  | "text" | "textarea" | "number" | "email" | "phone" | "url" | "select"
  | "checkboxes" | "date" | "file" | "address" | "country_tax" | "consent";

export type FormField = {
  id: string;
  type: FieldType;
  state: "required" | "optional" | "hidden";
  options?: string[];
  showIf?: { field: string; equals: string };
};

export type FormSection = { id: string; fields: FormField[] };
export type FormDefinition = { version: 1; sections: FormSection[] };

const f = (id: string, type: FieldType, state: FormField["state"] = "optional", extra: Partial<FormField> = {}): FormField => ({
  id, type, state, ...extra,
});

export function defaultFormDefinition(): FormDefinition {
  return {
    version: 1,
    sections: [
      {
        id: "business",
        fields: [
          f("companyName", "text", "required"),
          f("businessType", "select", "required", { options: ["retail", "salon", "restaurant", "distributor", "other"] }),
          f("website", "url"),
          f("yearEstablished", "number", "hidden"),
          f("locationsCount", "number", "hidden"),
          f("monthlyOrderValue", "select", "optional", { options: ["lt1k", "1k-5k", "5k-20k", "gt20k"] }),
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
  };
}
