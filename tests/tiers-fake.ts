/* eslint-disable @typescript-eslint/no-explicit-any -- fake GraphQL server returns untyped JSON */
// In-memory stand-in for admin.graphql used by the tiers/approval tests.
// Dispatches on the operation name in each query and keeps a tiny model of
// companies, locations, contacts and B2B markets, so read-backs are real.

export type Call = { op: string; variables: any };

export function fakeShopify() {
  let seq = 1;
  const id = (type: string) => `gid://shopify/${type}/${seq++}`;
  const companies = new Map<string, { id: string; externalId: string | null; name: string; locations: string[]; contacts: { id: string; customer: string }[]; main: string | null }>();
  const locations = new Map<string, { id: string; companyId: string; externalId: string | null; terms: string | null; draft: boolean; taxExempt: boolean; exemptions: string[]; reg: string | null; roles: string[] }>();
  const markets = new Map<string, { id: string; locs: string[]; catalogs: string[] }>();
  const customers = new Map<string, { id: string; email: string; name: string }>();
  const calls: Call[] = [];
  /** Hooks: return a payload to override the normal behaviour of an operation (e.g. inject a userError). */
  const hooks: Record<string, (v: any) => any | undefined> = {};

  const ue = (field: string, message: string, code: string) => ({ userErrors: [{ field: [field], message, code }] });
  const ok = (x: object) => ({ ...x, userErrors: [] });
  const companyOut = (c: any) => c && {
    id: c.id, externalId: c.externalId, mainContact: c.main ? { id: c.main } : null, defaultRole: null,
    contactRoles: { nodes: [{ id: "gid://shopify/CompanyContactRole/1", name: "Ordering only" }] },
    locations: { nodes: c.locations.map((l: string) => ({ id: l, externalId: locations.get(l)?.externalId ?? null })) },
    contacts: { nodes: c.contacts.map((x: any) => ({ id: x.id, customer: { id: x.customer } })) },
  };

  const handlers: Record<string, (v: any) => any> = {
    ApprovalFindCompany: (v) => {
      const ext = String(v.q).replace("external_id:", "");
      const c = [...companies.values()].find((x) => x.externalId === ext);
      return { companies: { nodes: c ? [companyOut(c)] : [] } };
    },
    TierFindCompany: (v) => handlers.ApprovalFindCompany(v),
    ApprovalCompany: (v) => ({ company: companyOut(companies.get(v.id)) ?? null }),
    ApprovalContacts: (v) => ({ company: companyOut(companies.get(v.id)) ?? null }),
    ApprovalCompanyCreate: (v) => {
      const c = { id: id("Company"), externalId: v.input.company.externalId ?? null, name: v.input.company.name, locations: [] as string[], contacts: [], main: null };
      companies.set(c.id, c);
      if (v.input.companyLocation) {
        const l = id("CompanyLocation");
        locations.set(l, { id: l, companyId: c.id, externalId: v.input.companyLocation.externalId ?? null, terms: null, draft: false, taxExempt: false, exemptions: [], reg: null, roles: [] });
        c.locations.push(l);
      }
      return { companyCreate: ok({ company: { id: c.id, locations: { nodes: c.locations.map((x) => ({ id: x })) } } }) };
    },
    TierPlaceholder: (v) => handlers.ApprovalCompanyCreate(v),
    ApprovalLocationCreate: (v) => {
      const l = id("CompanyLocation");
      locations.set(l, { id: l, companyId: v.companyId, externalId: v.input.externalId ?? null, terms: null, draft: false, taxExempt: false, exemptions: [], reg: null, roles: [] });
      companies.get(v.companyId)!.locations.push(l);
      return { companyLocationCreate: ok({ companyLocation: { id: l } }) };
    },
    ApprovalContactCreate: (v) => {
      if ([...customers.values()].some((c) => c.email === v.input.email)) return { companyContactCreate: { companyContact: null, ...ue("email", "Email has already been taken", "TAKEN") } };
      const cust = id("Customer");
      customers.set(cust, { id: cust, email: v.input.email, name: `${v.input.firstName ?? ""} ${v.input.lastName ?? ""}`.trim() });
      const cc = id("CompanyContact");
      companies.get(v.companyId)!.contacts.push({ id: cc, customer: cust });
      return { companyContactCreate: ok({ companyContact: { id: cc } }) };
    },
    ApprovalAssignCustomer: (v) => {
      const cc = id("CompanyContact");
      companies.get(v.companyId)!.contacts.push({ id: cc, customer: v.customerId });
      return { companyAssignCustomerAsContact: ok({ companyContact: { id: cc } }) };
    },
    ApprovalMainContact: (v) => {
      companies.get(v.companyId)!.main = v.companyContactId;
      return { companyAssignMainContact: ok({ company: { id: v.companyId } }) };
    },
    ApprovalLocation: (v) => {
      const l = locations.get(v.id);
      return { companyLocation: l && {
        id: l.id,
        buyerExperienceConfiguration: { checkoutToDraft: l.draft, paymentTermsTemplate: l.terms ? { id: l.terms } : null },
        taxSettings: { taxExempt: l.taxExempt, taxExemptions: l.exemptions, taxRegistrationId: l.reg },
        roleAssignments: { nodes: l.roles.map((r) => ({ companyContact: { id: r }, role: { id: "gid://shopify/CompanyContactRole/1" } })) },
      } };
    },
    ApprovalRoles: (v) => {
      locations.get(v.companyLocationId)!.roles.push(...v.rolesToAssign.map((r: any) => r.companyContactId));
      return { companyLocationAssignRoles: ok({ roleAssignments: [{ id: id("CompanyContactRoleAssignment") }] }) };
    },
    ApprovalLocationUpdate: (v) => {
      const l = locations.get(v.companyLocationId)!;
      const b = v.input.buyerExperienceConfiguration;
      l.terms = b.paymentTermsTemplateId ?? null;
      l.draft = Boolean(b.checkoutToDraft);
      return { companyLocationUpdate: ok({ companyLocation: { id: l.id } }) };
    },
    ApprovalTax: (v) => {
      const l = locations.get(v.companyLocationId)!;
      l.taxExempt = Boolean(v.taxExempt);
      l.exemptions = [...l.exemptions.filter((x) => !(v.exemptionsToRemove ?? []).includes(x)), ...(v.exemptionsToAssign ?? [])];
      if (v.taxRegistrationId) l.reg = v.taxRegistrationId;
      return { companyLocationTaxSettingsUpdate: ok({ companyLocation: { id: l.id } }) };
    },
    ApprovalWelcome: (v) => ({ companyContactSendWelcomeEmail: ok({ companyContact: { id: v.companyContactId } }) }),
    ApprovalCompanyDelete: (v) => {
      const c = companies.get(v.id)!;
      for (const l of c.locations) {
        locations.delete(l);
        for (const m of markets.values()) m.locs = m.locs.filter((x) => x !== l);
      }
      companies.delete(v.id);
      return { companyDelete: ok({ deletedCompanyId: v.id }) };
    },
    ApprovalLocationDelete: (v) => {
      locations.delete(v.companyLocationId);
      return { companyLocationDelete: ok({ deletedCompanyLocationId: v.companyLocationId }) };
    },
    ApprovalContactRemove: (v) => ({ companyContactRemoveFromCompany: ok({ removedCompanyContactId: v.companyContactId }) }),
    ApprovalCustomerByEmail: (v) => {
      const email = String(v.q).replace(/^email:"|"$/g, "");
      const c = [...customers.values()].find((x) => x.email === email);
      return { customers: { nodes: c ? [{ id: c.id, displayName: c.name, defaultEmailAddress: { emailAddress: c.email }, companyContactProfiles: [] }] : [] } };
    },
    ApprovalCustomer: (v) => {
      const c = customers.get(v.id);
      return { customer: c ? { id: c.id, displayName: c.name, defaultEmailAddress: { emailAddress: c.email }, companyContactProfiles: [] } : null };
    },
    TierMarketUpdate: (v) => {
      const m = markets.get(v.id);
      if (!m) return { marketUpdate: { market: null, ...ue("id", "Market not found", "NOT_FOUND") } };
      const c = v.input.conditions ?? {};
      const add: string[] = c.conditionsToAdd?.companyLocationsCondition?.companyLocationIds ?? [];
      const del: string[] = c.conditionsToDelete?.companyLocationsCondition?.companyLocationIds ?? [];
      const next = [...m.locs.filter((x) => !del.includes(x)), ...add.filter((x) => !m.locs.includes(x))];
      if (next.length === 0 && (add.length || del.length)) return { marketUpdate: { market: null, ...ue("conditions", "Specified conditions cannot be empty", "SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY") } };
      m.locs = next;
      return { marketUpdate: ok({ market: { id: m.id } }) };
    },
    TierMarketCreate: () => ({}),
    TierMembers: (v) => {
      const m = markets.get(v.id);
      return { market: m ? { id: m.id, conditions: { companyLocationsCondition: { companyLocations: { nodes: m.locs.map((x) => ({ id: x })), pageInfo: { hasNextPage: false, endCursor: null } } } } } : null };
    },
    TierBudget: () => ({ markets: { nodes: [...markets.values()].map((m) => ({ id: m.id, catalogs: { nodes: m.catalogs.map((c) => ({ id: c })) } })) } }),
    TierPaymentTerms: () => ({ paymentTermsTemplates: [{ id: "gid://shopify/PaymentTermsTemplate/4", translatedName: "Net 30", paymentTermsType: "NET", dueInDays: 30 }] }),
  };

  const admin = {
    graphql: async (query: string, opts?: { variables?: any }) => {
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
      const variables = opts?.variables ?? {};
      calls.push({ op, variables });
      const hooked = hooks[op]?.(variables);
      const data = hooked ?? handlers[op]?.(variables);
      if (!data) throw new Error(`fake shopify: no handler for ${op}`);
      return { json: async () => ({ data }) } as unknown as Response;
    },
  };

  return {
    admin: admin as any,
    calls,
    hooks,
    companies,
    locations,
    markets,
    customers,
    addMarket(locs: string[] = [], catalogs: string[] = []) {
      const m = { id: id("Market"), locs, catalogs };
      markets.set(m.id, m);
      return m.id;
    },
    addCustomer(email: string, name = "Existing Buyer") {
      const c = { id: id("Customer"), email, name };
      customers.set(c.id, c);
      return c.id;
    },
    count: (op: string) => calls.filter((c) => c.op === op).length,
  };
}
