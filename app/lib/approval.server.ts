// CONTRACT (owner: tiers/approval area). Implementation replaces the stub bodies.
import type { Admin } from "./gql.server";

export type Address = {
  firstName?: string; lastName?: string; company?: string;
  address1: string; address2?: string; city: string; zoneCode?: string; zip?: string; countryCode: string; phone?: string;
};

export type ApproveInput = {
  tierId: string;
  paymentTermsTemplateId: string | null;
  taxExempt: boolean;
  exemptions: string[]; // TaxExemption enum values
  taxRegistrationId: string | null;
  companyName: string;
  locationName: string;
  billingAddress: Address;
  shippingAddress: Address | null; // null = same as billing
  contact: { mode: "new" } | { mode: "existing"; customerGid: string };
  sendWelcome: boolean;
};

export const APPROVAL_STEPS = ["company", "location", "contact", "terms_tax", "tier", "email"] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];
export type StepState = { status: "pending" | "running" | "done" | "failed" | "skipped"; error?: string; gid?: string };
export type ApprovalState = { input: ApproveInput; steps: Record<ApprovalStep, StepState>; startedAt: string; finishedAt?: string };

export type ApprovalCtx = { admin: Admin; shop: string; actor: string };

/** Run (or continue) an approval. Idempotent: completed steps are skipped, so calling again = Retry. */
export async function approveApplication(_ctx: ApprovalCtx, _applicationId: string, _input: ApproveInput): Promise<ApprovalState> {
  throw new Error("approveApplication not implemented yet");
}

export async function retryApproval(_ctx: ApprovalCtx, _applicationId: string): Promise<ApprovalState> {
  throw new Error("retryApproval not implemented yet");
}

/** Remove what a partial approval created in Shopify (never touches pre-existing customers). */
export async function undoApproval(_ctx: ApprovalCtx, _applicationId: string): Promise<void> {
  throw new Error("undoApproval not implemented yet");
}

export type ApprovalDefaults = {
  input: ApproveInput;
  existingCustomer: { gid: string; name: string; email: string; otherCompany: string | null } | null;
  suggestedExemption: { exemption: string | null; reason: string };
  paymentTermsOptions: { id: string; name: string }[];
  tiers: { id: string; name: string }[];
  catalogBudget: { used: number | null; limit: number | null };
};

export async function approvalDefaults(_ctx: ApprovalCtx, _applicationId: string): Promise<ApprovalDefaults> {
  throw new Error("approvalDefaults not implemented yet");
}
