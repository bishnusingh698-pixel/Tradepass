// CONTRACT (owner: automation area). Implementation replaces the stub body.
import type { Admin } from "./gql.server";

export type RuleOutcome = { decided: "approved" | "rejected" | null; ruleId?: string };

/** Run auto-reject then auto-approve rules on a newly submitted application (Pro; respects Pause + daily limit). Never throws. */
export async function evaluateRules(_admin: Admin, _shop: string, _applicationId: string): Promise<RuleOutcome> {
  return { decided: null };
}
