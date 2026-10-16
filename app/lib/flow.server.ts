// CONTRACT (owner: automation/flow area). Implementation replaces the stub body.
import type { Admin } from "./gql.server";

export type FlowTrigger =
  | "application_submitted" | "application_approved" | "application_rejected"
  | "certificate_expiring" | "certificate_expired";

export type FlowPayload = {
  applicationId?: string;
  buyerId?: string;
  companyGid?: string;
  companyName?: string;
  contactEmail?: string;
  country?: string;
  tierName?: string;
  expiryDate?: string;
};

/** Fire a Flow trigger if the shop's plan includes Flow. Never throws (failures are logged to the activity log). */
export async function emitFlowTrigger(_admin: Admin, _shop: string, _trigger: FlowTrigger, _payload: FlowPayload): Promise<void> {
  // stub: no-op until implemented
}
