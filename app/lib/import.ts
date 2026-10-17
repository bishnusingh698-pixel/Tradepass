// Import field list and shared types (safe for the browser). Server logic: import.server.ts.

export const IMPORT_FIELDS = [
  "company_name", "email", "first_name", "last_name", "phone",
  "address1", "address2", "city", "zone_code", "zip", "country_code",
  "location_name", "tier", "payment_terms", "tax_registration_id", "tax_exemptions",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ["company_name", "email", "address1", "city", "country_code"];

export type ColumnMap = Partial<Record<ImportField, number | null>>;

export type IssueCode =
  | "required" | "invalid_email" | "invalid_country" | "zone_required" | "invalid_phone"
  | "unknown_tier" | "no_tier" | "unknown_terms" | "invalid_exemption"
  | "duplicate_in_file" | "existing_company" | "existing_customer" | "customer_in_company"
  | "already_buyer" | "no_address" | "step_failed" | "failed";
export type Issue = { row: number; field: ImportField | null; level: "error" | "warning"; code: IssueCode };

export type ExistingOption = "skip" | "link";
export type CsvOptions = { defaultTierId: string | null; onExisting: ExistingOption; sendWelcome: boolean };
