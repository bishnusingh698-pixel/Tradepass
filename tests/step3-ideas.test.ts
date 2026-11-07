// Step 3 ideas built from merchant research (DECISIONS D-104).
import { describe, expect, it } from "vitest";
import { riskHints } from "../app/lib/risk";
import { matchCondition, sanitizeRules, type ApplicationFacts } from "../app/lib/rules";

describe("throwaway email hint", () => {
  const base = { companyName: "Acme Trading", website: "acme.example" };
  it("flags throwaway inboxes instead of 'free email' and skips the website comparison", () => {
    expect(riskHints({ ...base, email: "buyer@mailinator.com" })).toEqual(["disposable_email"]);
    expect(riskHints({ ...base, email: "buyer@YOPMAIL.com" })).toEqual(["disposable_email"]);
    expect(riskHints({ ...base, email: "buyer@gmail.com" })).toEqual(["free_email"]);
    expect(riskHints({ ...base, email: "buyer@acme.example" })).toEqual([]);
  });
  it("is an automation condition that survives sanitising", () => {
    const f = { risk: ["disposable_email"], flags: [], answers: {} } as unknown as ApplicationFacts;
    expect(matchCondition({ type: "disposable_email" }, f)).toBe(true);
    expect(matchCondition({ type: "free_email" }, f)).toBe(false);
    const rules = sanitizeRules([{ kind: "reject", enabled: true, conditions: { match: "all", list: [{ type: "disposable_email" }] }, action: {} }]);
    expect(rules[0]?.conditions.list).toEqual([{ type: "disposable_email" }]);
  });
});
