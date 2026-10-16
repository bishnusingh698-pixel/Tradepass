/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL payloads are untyped JSON at this boundary */
// CONTRACT (owner: tiers/approval area).
//
// Approval engine: company → location → contact → terms & tax → tier → email.
// Each step is verified by reading back from Shopify and the state is saved
// after every step, so Retry continues where it stopped and never duplicates
// (objects carry our externalId and stored GIDs are checked first). Undo
// removes only what this approval created. Fields verified against Admin
// GraphQL 2026-10 (docs/notes/tiers.md).
import type { Application, Tier } from "@prisma/client";
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { gql, mutate, GqlError, UserErrorsError, type Admin } from "./gql.server";
import { logActivity } from "./activity.server";
import { decrypt, sha256 } from "./crypto.server";
import { queueEmail } from "./email/index.server";
import { emitFlowTrigger } from "./flow.server";
import { createT } from "./i18n";
import { LockBusyError, withLock } from "./lock.server";
import { approvalQuota, effectivePlan } from "./plans";
import { approvalsThisMonth } from "./applications.server";
import { readSettings } from "./settings";
import { suggestExemption, US_RESELLER_STATES } from "./tax";
import {
  AssignmentError, ASSISTED_JOB, catalogBudget, moveLocations, paymentTermsOptions, readDefaults, TierError,
} from "./tiers.server";

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
  /** "new" may carry the contact's details; for applications they default to the applicant's. */
  contact:
    | { mode: "new"; email?: string; firstName?: string; lastName?: string; phone?: string; locale?: string }
    | { mode: "existing"; customerGid: string };
  sendWelcome: boolean;
  /** Orders go to the merchant as drafts (buyer experience checkoutToDraft). Defaults to the tier's setting. */
  checkoutToDraft?: boolean;
};

export const APPROVAL_STEPS = ["company", "location", "contact", "terms_tax", "tier", "email"] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];
export type StepState = {
  status: "pending" | "running" | "done" | "failed" | "skipped";
  error?: string; // plain-language, already translated
  gid?: string;
  code?: string; // error code (approval.error.<code>)
  created?: boolean; // true = this approval created the Shopify object (Undo may remove it)
  pendingAssignment?: boolean; // tier step in assisted mode: waiting for the merchant
  jobIds?: string[];
};
export type ApprovalState = {
  input: ApproveInput;
  steps: Record<ApprovalStep, StepState>;
  startedAt: string;
  finishedAt?: string;
  buyerId?: string;
  autoRetries?: number;
};

export type ApprovalCtx = { admin: Admin; shop: string; actor: string; t?: (key: string, values?: Record<string, string | number | Date>) => string };

export type ApprovalErrorCode = "plan_limit" | "not_found" | "not_pending" | "busy" | "no_state" | "finished" | "missing_address" | "tier_required";
export class ApprovalError extends Error {
  constructor(readonly code: ApprovalErrorCode) {
    super(code);
    this.name = "ApprovalError";
  }
}

/** All 74 TaxExemption values (Admin GraphQL 2026-10), for the editable picker. */
export const TAX_EXEMPTIONS: string[] = [
  ...US_RESELLER_STATES.map((s) => `US_${s}_RESELLER_EXEMPTION`),
  "CA_BC_COMMERCIAL_FISHERY_EXEMPTION", "CA_BC_CONTRACTOR_EXEMPTION", "CA_BC_PRODUCTION_AND_MACHINERY_EXEMPTION",
  "CA_BC_RESELLER_EXEMPTION", "CA_BC_SUB_CONTRACTOR_EXEMPTION", "CA_DIPLOMAT_EXEMPTION", "CA_MB_COMMERCIAL_FISHERY_EXEMPTION",
  "CA_MB_FARMER_EXEMPTION", "CA_MB_RESELLER_EXEMPTION", "CA_NL_VPT_RESELLER_EXEMPTION", "CA_NS_COMMERCIAL_FISHERY_EXEMPTION",
  "CA_NS_FARMER_EXEMPTION", "CA_ON_PURCHASE_EXEMPTION", "CA_PE_COMMERCIAL_FISHERY_EXEMPTION", "CA_SK_COMMERCIAL_FISHERY_EXEMPTION",
  "CA_SK_CONTRACTOR_EXEMPTION", "CA_SK_FARMER_EXEMPTION", "CA_SK_PRODUCTION_AND_MACHINERY_EXEMPTION", "CA_SK_RESELLER_EXEMPTION",
  "CA_SK_SUB_CONTRACTOR_EXEMPTION", "CA_SK_VPT_RESELLER_EXEMPTION", "CA_STATUS_CARD_EXEMPTION",
  "EU_REVERSE_CHARGE_EXEMPTION_RULE",
];

const Q = {
  company: `#graphql
    query ApprovalCompany($id: ID!) { company(id: $id) { id externalId mainContact { id }
      locations(first: 50) { nodes { id externalId } } } }`,
  findCompany: `#graphql
    query ApprovalFindCompany($q: String!) { companies(first: 1, query: $q) { nodes { id locations(first: 50) { nodes { id externalId } } } } }`,
  companyCreate: `#graphql
    mutation ApprovalCompanyCreate($input: CompanyCreateInput!) { companyCreate(input: $input) {
      company { id locations(first: 1) { nodes { id } } } userErrors { field message code } } }`,
  location: `#graphql
    query ApprovalLocation($id: ID!) { companyLocation(id: $id) { id
      buyerExperienceConfiguration { checkoutToDraft paymentTermsTemplate { id } }
      taxSettings { taxExempt taxExemptions taxRegistrationId }
      roleAssignments(first: 50) { nodes { companyContact { id } role { id } } } } }`,
  locationCreate: `#graphql
    mutation ApprovalLocationCreate($companyId: ID!, $input: CompanyLocationInput!) { companyLocationCreate(companyId: $companyId, input: $input) {
      companyLocation { id } userErrors { field message code } } }`,
  contacts: `#graphql
    query ApprovalContacts($id: ID!) { company(id: $id) { id mainContact { id } defaultRole { id }
      contactRoles(first: 10) { nodes { id name } }
      contacts(first: 50) { nodes { id customer { id } } } } }`,
  contactsNoCustomer: `#graphql
    query ApprovalContactsLite($id: ID!) { company(id: $id) { id mainContact { id } defaultRole { id }
      contactRoles(first: 10) { nodes { id name } } contacts(first: 50) { nodes { id } } } }`,
  contactCreate: `#graphql
    mutation ApprovalContactCreate($companyId: ID!, $input: CompanyContactInput!) { companyContactCreate(companyId: $companyId, input: $input) {
      companyContact { id } userErrors { field message code } } }`,
  assignCustomer: `#graphql
    mutation ApprovalAssignCustomer($companyId: ID!, $customerId: ID!) { companyAssignCustomerAsContact(companyId: $companyId, customerId: $customerId) {
      companyContact { id } userErrors { field message code } } }`,
  mainContact: `#graphql
    mutation ApprovalMainContact($companyId: ID!, $companyContactId: ID!) { companyAssignMainContact(companyId: $companyId, companyContactId: $companyContactId) {
      company { id } userErrors { field message code } } }`,
  assignRoles: `#graphql
    mutation ApprovalRoles($companyLocationId: ID!, $rolesToAssign: [CompanyLocationRoleAssign!]!) {
      companyLocationAssignRoles(companyLocationId: $companyLocationId, rolesToAssign: $rolesToAssign) {
        roleAssignments { id } userErrors { field message code } } }`,
  locationUpdate: `#graphql
    mutation ApprovalLocationUpdate($companyLocationId: ID!, $input: CompanyLocationUpdateInput!) { companyLocationUpdate(companyLocationId: $companyLocationId, input: $input) {
      companyLocation { id } userErrors { field message code } } }`,
  taxUpdate: `#graphql
    mutation ApprovalTax($companyLocationId: ID!, $taxExempt: Boolean, $exemptionsToAssign: [TaxExemption!], $exemptionsToRemove: [TaxExemption!], $taxRegistrationId: String) {
      companyLocationTaxSettingsUpdate(companyLocationId: $companyLocationId, taxExempt: $taxExempt, exemptionsToAssign: $exemptionsToAssign,
        exemptionsToRemove: $exemptionsToRemove, taxRegistrationId: $taxRegistrationId) {
        companyLocation { id } userErrors { field message code } } }`,
  welcome: `#graphql
    mutation ApprovalWelcome($companyContactId: ID!) { companyContactSendWelcomeEmail(companyContactId: $companyContactId) {
      companyContact { id } userErrors { field message code } } }`,
  companyDelete: `#graphql
    mutation ApprovalCompanyDelete($id: ID!) { companyDelete(id: $id) { deletedCompanyId userErrors { field message code } } }`,
  locationDelete: `#graphql
    mutation ApprovalLocationDelete($companyLocationId: ID!) { companyLocationDelete(companyLocationId: $companyLocationId) {
      deletedCompanyLocationId userErrors { field message code } } }`,
  contactRemove: `#graphql
    mutation ApprovalContactRemove($companyContactId: ID!) { companyContactRemoveFromCompany(companyContactId: $companyContactId) {
      removedCompanyContactId userErrors { field message code } } }`,
  customerByEmail: `#graphql
    query ApprovalCustomerByEmail($q: String!) { customers(first: 1, query: $q) { nodes {
      id displayName defaultEmailAddress { emailAddress } companyContactProfiles { company { id name } } } } }`,
  customer: `#graphql
    query ApprovalCustomer($id: ID!) { customer(id: $id) {
      id displayName defaultEmailAddress { emailAddress } companyContactProfiles { company { id name } } } }`,
};

// ---------- helpers ----------

export function emptySteps(): Record<ApprovalStep, StepState> {
  return Object.fromEntries(APPROVAL_STEPS.map((s) => [s, { status: "pending" }])) as Record<ApprovalStep, StepState>;
}

function readState(raw: unknown): ApprovalState | null {
  const s = raw as ApprovalState | null;
  return s && s.steps && s.input ? s : null;
}

async function translator(ctx: ApprovalCtx) {
  if (ctx.t) return ctx.t;
  const row = await db.shop.findUnique({ where: { shop: ctx.shop }, select: { primaryLocale: true } });
  return createT(row?.primaryLocale ?? "en").t;
}

/** Map any failure to a code the merchant sees in plain words (approval.error.<code>). */
export function errorCode(e: unknown): { code: string; detail?: string } {
  if (e instanceof StepError) return { code: e.code, detail: e.detail };
  if (e instanceof AssignmentError) return { code: e.code };
  if (e instanceof TierError) return { code: e.code === "shopify" ? "shopify" : e.code, detail: e.detail };
  if (e instanceof LockBusyError) return { code: "busy" };
  if (e instanceof UserErrorsError) {
    if (e.hasCode("B2B_CATALOG_LIMIT_REACHED")) return { code: "catalog_limit" };
    return { code: "shopify", detail: e.userErrors.map((u) => u.message).join(" ") };
  }
  if (e instanceof GqlError) return { code: /throttl/i.test(JSON.stringify(e.errors ?? "")) ? "network" : "shopify", detail: e.message };
  return { code: "network" };
}

/** Failures worth retrying automatically from the hourly job (nothing the merchant must fix first). */
export const TRANSIENT_CODES = new Set(["busy", "concurrent", "network", "verify_failed"]);

class StepError extends Error {
  constructor(readonly code: string, readonly detail?: string) {
    super(code);
    this.name = "StepError";
  }
}

const addr = (a: Address | null | undefined) =>
  a
    ? {
        address1: a.address1, address2: a.address2 || undefined, city: a.city, countryCode: a.countryCode,
        zoneCode: a.zoneCode || undefined, zip: a.zip || undefined, phone: a.phone || undefined,
        firstName: a.firstName || undefined, lastName: a.lastName || undefined, recipient: a.company || undefined,
      }
    : undefined;

export function validAddress(a: Partial<Address> | null | undefined): a is Address {
  return Boolean(a && a.address1?.trim() && a.city?.trim() && a.countryCode?.trim());
}

/** Read an address out of the form answers (fields as the storefront form posts them). */
export function addressFromAnswers(raw: unknown, fallbackCountry?: string | null): Address | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const a: Address = {
    firstName: s("firstName") || undefined, lastName: s("lastName") || undefined, company: s("company") || undefined,
    address1: s("address1"), address2: s("address2") || undefined, city: s("city"),
    zoneCode: s("zoneCode") || s("province") || s("state") || undefined, zip: s("zip") || s("postalCode") || undefined,
    countryCode: (s("countryCode") || s("country") || fallbackCountry || "").toUpperCase(), phone: s("phone") || undefined,
  };
  return a.address1 || a.city ? a : null;
}

// ---------- the step machine ----------

type Run = {
  ctx: ApprovalCtx;
  state: ApprovalState;
  externalId: string;
  existingCompanyGid?: string;
  email: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  locale: string;
  save: (s: ApprovalState) => Promise<void>;
};

async function companyNode(admin: Admin, id: string) {
  return (await gql(admin, Q.company, { id })).company as { id: string; mainContact: { id: string } | null; locations: { nodes: { id: string; externalId: string | null }[] } } | null;
}

const STEP_FNS: Record<ApprovalStep, (r: Run) => Promise<void>> = {
  async company(r) {
    const st = r.state.steps.company;
    const { admin } = r.ctx;
    if (r.existingCompanyGid) {
      if (!(await companyNode(admin, r.existingCompanyGid))) throw new StepError("missing_in_shopify");
      Object.assign(st, { gid: r.existingCompanyGid, created: false });
      return;
    }
    if (st.gid && (await companyNode(admin, st.gid))) return;
    if (st.gid) {
      // Deleted in Shopify since the last attempt: start this approval's objects again.
      for (const s of APPROVAL_STEPS) if (s !== "company") r.state.steps[s] = { status: "pending" };
      delete st.gid;
    }
    const found = (await gql(admin, Q.findCompany, { q: `external_id:${r.externalId}` })).companies?.nodes?.[0];
    if (found) {
      Object.assign(st, { gid: found.id, created: true });
      const loc = found.locations?.nodes?.find((l: any) => l.externalId === `${r.externalId}-loc`);
      if (loc) Object.assign(r.state.steps.location, { gid: loc.id, created: true });
      return;
    }
    const i = r.state.input;
    const res = await mutate(admin, "companyCreate", Q.companyCreate, {
      input: {
        company: { name: i.companyName, externalId: r.externalId },
        companyLocation: locationInput(r),
      },
    });
    Object.assign(st, { gid: res.company.id, created: true });
    const loc = res.company.locations?.nodes?.[0]?.id;
    if (loc) Object.assign(r.state.steps.location, { gid: loc, created: true });
    await logActivity({ shop: r.ctx.shop, actor: r.ctx.actor, action: "approval.company_created", subject: res.company.id });
  },

  async location(r) {
    const st = r.state.steps.location;
    const companyGid = r.state.steps.company.gid!;
    const company = await companyNode(r.ctx.admin, companyGid);
    if (!company) throw new StepError("missing_in_shopify");
    if (st.gid && company.locations.nodes.some((l) => l.id === st.gid)) return;
    const ours = company.locations.nodes.find((l) => l.externalId === `${r.externalId}-loc`);
    if (ours) {
      Object.assign(st, { gid: ours.id, created: true });
      return;
    }
    const res = await mutate(r.ctx.admin, "companyLocationCreate", Q.locationCreate, { companyId: companyGid, input: locationInput(r) });
    Object.assign(st, { gid: res.companyLocation.id, created: true });
    await logActivity({ shop: r.ctx.shop, actor: r.ctx.actor, action: "approval.location_created", subject: res.companyLocation.id });
  },

  async contact(r) {
    const st = r.state.steps.contact;
    const { admin, shop, actor } = r.ctx;
    const companyGid = r.state.steps.company.gid!;
    const locationGid = r.state.steps.location.gid!;
    const c = r.state.input.contact;
    let company: any;
    try {
      company = (await gql(admin, Q.contacts, { id: companyGid })).company;
    } catch (e) {
      if (!(e instanceof GqlError)) throw e;
      company = (await gql(admin, Q.contactsNoCustomer, { id: companyGid })).company; // no customer access
    }
    if (!company) throw new StepError("missing_in_shopify");
    const contacts: { id: string; customer?: { id: string } }[] = company.contacts?.nodes ?? [];

    if (!(st.gid && contacts.some((x) => x.id === st.gid))) {
      delete st.gid;
      if (c.mode === "existing") {
        const linked = contacts.find((x) => x.customer?.id === c.customerGid);
        if (linked) Object.assign(st, { gid: linked.id, created: r.state.steps.company.created === true });
        else {
          const res = await mutate(admin, "companyAssignCustomerAsContact", Q.assignCustomer, { companyId: companyGid, customerId: c.customerGid });
          Object.assign(st, { gid: res.companyContact.id, created: true });
          await logActivity({ shop, actor, action: "approval.customer_linked", subject: res.companyContact.id });
        }
      } else if (r.state.steps.company.created && contacts.length === 1 && !r.existingCompanyGid) {
        // A crash after creating the contact: the only contact of a company we made is ours.
        Object.assign(st, { gid: contacts[0].id, created: true });
      } else {
        if (!r.email) throw new StepError("contact_email_missing");
        try {
          const res = await mutate(admin, "companyContactCreate", Q.contactCreate, {
            companyId: companyGid,
            input: { email: r.email, firstName: r.firstName || undefined, lastName: r.lastName || undefined, phone: r.phone || undefined, locale: r.locale },
          });
          Object.assign(st, { gid: res.companyContact.id, created: true });
          await logActivity({ shop, actor, action: "approval.contact_created", subject: res.companyContact.id });
        } catch (e) {
          // The email already belongs to a customer: link that customer instead of failing.
          if (!(e instanceof UserErrorsError && e.hasCode("TAKEN"))) throw e;
          const existing = await findCustomerByEmail(admin, r.email);
          if (!existing) throw new StepError("contact_email_taken");
          const res = await mutate(admin, "companyAssignCustomerAsContact", Q.assignCustomer, { companyId: companyGid, customerId: existing.gid });
          Object.assign(st, { gid: res.companyContact.id, created: true });
          await logActivity({ shop, actor, action: "approval.customer_linked", subject: res.companyContact.id });
        }
      }
    }

    if (!company.mainContact) await mutate(admin, "companyAssignMainContact", Q.mainContact, { companyId: companyGid, companyContactId: st.gid });

    // The contact needs a role on the location to order there.
    const hasRole = async () => {
      const loc = (await gql(admin, Q.location, { id: locationGid })).companyLocation;
      return (loc?.roleAssignments?.nodes ?? []).some((n: any) => n.companyContact?.id === st.gid);
    };
    if (!(await hasRole())) {
      const roles: { id: string; name: string }[] = company.contactRoles?.nodes ?? [];
      const roleId = company.defaultRole?.id ?? roles.find((x) => /order/i.test(x.name))?.id ?? roles[0]?.id;
      if (!roleId) throw new StepError("no_contact_role");
      await mutate(admin, "companyLocationAssignRoles", Q.assignRoles, {
        companyLocationId: locationGid, rolesToAssign: [{ companyContactId: st.gid, companyContactRoleId: roleId }],
      });
      if (!(await hasRole())) throw new StepError("verify_failed");
    }
  },

  async terms_tax(r) {
    const i = r.state.input;
    const { admin, shop, actor } = r.ctx;
    const locationGid = r.state.steps.location.gid!;
    const draft = Boolean(i.checkoutToDraft);
    const loc = (await gql(admin, Q.location, { id: locationGid })).companyLocation;
    if (!loc) throw new StepError("missing_in_shopify");
    const termsOk = (l: any) =>
      (l.buyerExperienceConfiguration?.paymentTermsTemplate?.id ?? null) === (i.paymentTermsTemplateId ?? null) &&
      Boolean(l.buyerExperienceConfiguration?.checkoutToDraft) === draft;
    const want = i.taxExempt ? [...new Set(i.exemptions)] : [];
    const taxOk = (l: any) => {
      const ts = l.taxSettings ?? {};
      const have: string[] = ts.taxExemptions ?? [];
      return Boolean(ts.taxExempt) === Boolean(i.taxExempt) && have.length === want.length && want.every((x) => have.includes(x)) &&
        (i.taxRegistrationId ? ts.taxRegistrationId === i.taxRegistrationId : true);
    };
    if (!termsOk(loc)) {
      await mutate(admin, "companyLocationUpdate", Q.locationUpdate, {
        companyLocationId: locationGid,
        input: { buyerExperienceConfiguration: { paymentTermsTemplateId: i.paymentTermsTemplateId, checkoutToDraft: draft } },
      });
      await logActivity({ shop, actor, action: "approval.terms_set", subject: locationGid, detail: { paymentTermsTemplateId: i.paymentTermsTemplateId, checkoutToDraft: draft } });
    }
    if (!taxOk(loc)) {
      const have: string[] = loc.taxSettings?.taxExemptions ?? [];
      await mutate(admin, "companyLocationTaxSettingsUpdate", Q.taxUpdate, {
        companyLocationId: locationGid,
        taxExempt: Boolean(i.taxExempt),
        exemptionsToAssign: want.filter((x) => !have.includes(x)),
        exemptionsToRemove: have.filter((x) => !want.includes(x)),
        ...(i.taxRegistrationId ? { taxRegistrationId: i.taxRegistrationId } : {}),
      });
      await logActivity({ shop, actor, action: "approval.tax_set", subject: locationGid, detail: { taxExempt: i.taxExempt, exemptions: want } });
    }
    const after = (await gql(admin, Q.location, { id: locationGid })).companyLocation;
    if (!after || !termsOk(after) || !taxOk(after)) throw new StepError("verify_failed");
  },

  async tier(r) {
    const st = r.state.steps.tier;
    const tier = await db.tier.findFirst({ where: { id: r.state.input.tierId, shop: r.ctx.shop } });
    if (!tier) throw new StepError("tier_missing");
    if (tier.syncState === "missing") throw new StepError("tier_missing");
    if (st.pendingAssignment && st.jobIds?.length) return; // assisted: already recorded
    const res = await moveLocations(r.ctx, [r.state.steps.location.gid!], null, tier, { buyerId: r.state.buyerId ?? null });
    Object.assign(st, { gid: tier.marketGid ?? tier.catalogGid ?? undefined, created: true, pendingAssignment: res.mode === "assisted", jobIds: res.jobIds });
    await logActivity({ shop: r.ctx.shop, actor: r.ctx.actor, action: "tier.assign", subject: r.state.steps.location.gid!, detail: { tierId: tier.id, mode: res.mode } });
  },

  async email(r) {
    const st = r.state.steps.email;
    const i = r.state.input;
    if (!i.sendWelcome) {
      st.status = "skipped";
      return;
    }
    const row = await db.shop.findUnique({ where: { shop: r.ctx.shop } });
    const settings = readSettings(row?.settings ?? {});
    if (settings.notifications.useShopifyWelcome && r.state.steps.contact.gid) {
      try {
        await mutate(r.ctx.admin, "companyContactSendWelcomeEmail", Q.welcome, { companyContactId: r.state.steps.contact.gid });
        await logActivity({ shop: r.ctx.shop, actor: r.ctx.actor, action: "approval.welcome_sent", subject: r.state.steps.contact.gid, detail: { via: "shopify" } });
        st.gid = "shopify";
        return;
      } catch {
        // Fall back to our own "You're approved" email (D-005).
      }
    }
    if (!r.email) {
      st.status = "skipped";
      return;
    }
    const tier = await db.tier.findFirst({ where: { id: i.tierId, shop: r.ctx.shop } });
    const tierName = ((tier?.buyerNames ?? {}) as Record<string, string>)[r.locale] || tier?.name || "";
    const res = await queueEmail({
      shop: r.ctx.shop, type: "approved", to: r.email, locale: r.locale, subjectId: r.state.buyerId,
      vars: { company: i.companyName, first_name: r.firstName ?? "", store_name: row?.name ?? "", tier_name: tierName, login_url: settings.storefront.loginUrl },
    });
    if (!res.queued && res.reason === "disabled") {
      st.status = "skipped";
      return;
    }
    if (!res.queued) throw new StepError("email_failed");
    st.gid = "tradepass";
  },
};

function locationInput(r: Run) {
  const i = r.state.input;
  return {
    name: i.locationName || i.companyName,
    externalId: `${r.externalId}-loc`,
    locale: r.locale,
    billingAddress: addr(i.billingAddress),
    ...(i.shippingAddress ? { shippingAddress: addr(i.shippingAddress), billingSameAsShipping: false } : { shippingAddress: addr(i.billingAddress), billingSameAsShipping: true }),
  };
}

async function findCustomerByEmail(admin: Admin, email: string) {
  try {
    const n = (await gql(admin, Q.customerByEmail, { q: `email:"${email.replace(/"/g, "")}"` })).customers?.nodes?.[0];
    return n ? toCustomer(n) : null;
  } catch {
    return null; // needs read_customers; without it we can't look up by email
  }
}

function toCustomer(n: any) {
  return {
    gid: n.id as string,
    name: n.displayName as string,
    email: (n.defaultEmailAddress?.emailAddress ?? "") as string,
    companies: ((n.companyContactProfiles ?? []) as any[]).map((p) => ({ id: p.company?.id as string, name: p.company?.name as string })),
  };
}

/** Runs every step that isn't done; stops at the first failure. Steps before email must succeed for the buyer to exist. */
async function runSteps(r: Run, finalize: (r: Run) => Promise<void>): Promise<ApprovalState> {
  const t = await translator(r.ctx);
  for (const step of APPROVAL_STEPS) {
    if (step === "email" && !r.state.buyerId) {
      await finalize(r);
      await r.save(r.state);
    }
    const st = r.state.steps[step];
    if (st.status === "done" || st.status === "skipped") continue;
    st.status = "running";
    delete st.error;
    delete st.code;
    await r.save(r.state);
    try {
      await STEP_FNS[step](r);
      if (st.status === "running") st.status = "done";
      await r.save(r.state);
    } catch (e) {
      const { code, detail } = errorCode(e);
      st.status = "failed";
      st.code = code;
      st.error = t(`approval.error.${code}`, { detail: detail ?? "" });
      await r.save(r.state);
      await logActivity({ shop: r.ctx.shop, actor: r.ctx.actor, action: `approval.step_failed`, subject: r.externalId, result: "failed", detail: { step, code } });
      return r.state;
    }
  }
  r.state.finishedAt = new Date().toISOString();
  await r.save(r.state);
  return r.state;
}

// ---------- applications ----------

function contactFromApp(app: Application, input: ApproveInput) {
  const a = (app.answers ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  const c = input.contact.mode === "new" ? input.contact : null;
  return {
    email: c?.email || app.email || null,
    firstName: c?.firstName ?? s("firstName"),
    lastName: c?.lastName ?? s("lastName"),
    phone: c?.phone ?? s("phone"),
    locale: c?.locale || s("preferredLanguage") || app.locale || "en",
  };
}

async function checkQuota(shop: string) {
  const row = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true, isDevStore: true } });
  const plan = effectivePlan(row?.billingPlan ?? "free", Boolean(row?.isDevStore));
  if (approvalQuota(plan, await approvalsThisMonth(shop)).blocked) throw new ApprovalError("plan_limit");
}

function appRun(ctx: ApprovalCtx, app: Application, state: ApprovalState): Run {
  const c = contactFromApp(app, state.input);
  return {
    ctx, state, externalId: `tradepass-${app.id}`, ...c,
    save: async (s) => {
      await db.application.updateMany({ where: { id: app.id, shop: ctx.shop }, data: { approvalState: s as unknown as Prisma.InputJsonValue } });
    },
  };
}

async function finalizeApplication(app: Application, r: Run, source: "application" = "application") {
  const { ctx, state } = r;
  const i = state.input;
  const companyGid = state.steps.company.gid!;
  const locationGid = state.steps.location.gid!;
  const buyer = await db.buyer.upsert({
    where: { shop_companyGid: { shop: ctx.shop, companyGid } },
    create: {
      shop: ctx.shop, companyGid, locationGids: [locationGid], contactGid: state.steps.contact.gid ?? null, tierId: i.tierId,
      taxExemptions: i.taxExempt ? i.exemptions : [], country: i.billingAddress.countryCode, source, name: i.companyName,
    },
    update: { tierId: i.tierId, contactGid: state.steps.contact.gid ?? undefined, status: "active", pausedTierId: null },
  });
  if (!buyer.locationGids.includes(locationGid))
    await db.buyer.update({ where: { id: buyer.id }, data: { locationGids: [...buyer.locationGids, locationGid] } });
  state.buyerId = buyer.id;
  await attachJobsToBuyer(ctx.shop, state.steps.tier.jobIds, buyer.id);
  await db.application.updateMany({ where: { id: app.id, shop: ctx.shop }, data: { status: "approved", decidedAt: new Date(), buyerId: buyer.id } });
  await db.certificate.updateMany({ where: { shop: ctx.shop, applicationId: app.id, buyerId: null }, data: { buyerId: buyer.id } });
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "application.approve", subject: app.id, detail: { buyerId: buyer.id, tierId: i.tierId, companyGid } });
  const tier = await db.tier.findFirst({ where: { id: i.tierId, shop: ctx.shop }, select: { name: true } });
  await emitFlowTrigger(ctx.admin, ctx.shop, "application_approved", {
    applicationId: app.id, buyerId: buyer.id, companyGid, companyName: i.companyName,
    contactEmail: r.email ?? undefined, country: i.billingAddress.countryCode, tierName: tier?.name,
  }).catch(() => undefined);
}

async function attachJobsToBuyer(shop: string, jobIds: string[] | undefined, buyerId: string) {
  for (const id of jobIds ?? []) {
    const job = await db.job.findFirst({ where: { id, shop, type: ASSISTED_JOB } });
    if (job) await db.job.update({ where: { id }, data: { payload: { ...(job.payload as object), buyerId } } });
  }
}

async function loadApp(ctx: ApprovalCtx, id: string) {
  const app = await db.application.findFirst({ where: { id, shop: ctx.shop } });
  if (!app) throw new ApprovalError("not_found");
  return app;
}

function checkInput(input: ApproveInput) {
  if (!input.tierId) throw new ApprovalError("tier_required");
  if (!validAddress(input.billingAddress) || (input.shippingAddress && !validAddress(input.shippingAddress))) throw new ApprovalError("missing_address");
}

/** Run (or continue) an approval. Idempotent: completed steps are skipped, so calling again = Retry. */
export async function approveApplication(ctx: ApprovalCtx, applicationId: string, input: ApproveInput): Promise<ApprovalState> {
  checkInput(input);
  return lockApp(ctx, applicationId, async () => {
    const app = await loadApp(ctx, applicationId);
    const prev = readState(app.approvalState);
    if (app.status === "approved" && prev?.finishedAt) return prev;
    if (!["pending", "needs_info", "approved"].includes(app.status)) throw new ApprovalError("not_pending");
    if (!prev || !prev.steps.company.gid) await checkQuota(ctx.shop);
    // Keep GIDs from an earlier attempt; take the merchant's latest choices for what's left.
    const state: ApprovalState = prev
      ? { ...prev, input }
      : { input, steps: emptySteps(), startedAt: new Date().toISOString() };
    const r = appRun(ctx, app, state);
    return runSteps(r, (run) => finalizeApplication(app, run));
  });
}

export async function retryApproval(ctx: ApprovalCtx, applicationId: string): Promise<ApprovalState> {
  return lockApp(ctx, applicationId, async () => {
    const app = await loadApp(ctx, applicationId);
    const state = readState(app.approvalState);
    if (!state) throw new ApprovalError("no_state");
    if (state.finishedAt) return state;
    const r = appRun(ctx, app, state);
    return runSteps(r, (run) => finalizeApplication(app, run));
  });
}

async function lockApp<T>(ctx: ApprovalCtx, id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withLock(ctx.shop, `approval:${id}`, fn, 3_000);
  } catch (e) {
    if (e instanceof LockBusyError) throw new ApprovalError("busy");
    throw e;
  }
}

/** Remove what a partial approval created in Shopify (never touches pre-existing customers). */
export async function undoApproval(ctx: ApprovalCtx, applicationId: string): Promise<void> {
  await lockApp(ctx, applicationId, async () => {
    const app = await loadApp(ctx, applicationId);
    const state = readState(app.approvalState);
    if (!state) return;
    if (app.status === "approved" || state.buyerId) throw new ApprovalError("finished");
    await undoState(ctx, state, applicationId);
    await db.application.updateMany({ where: { id: app.id, shop: ctx.shop }, data: { approvalState: Prisma.DbNull } });
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "approval.undo", subject: app.id });
  });
}

async function undoState(ctx: ApprovalCtx, state: ApprovalState, subject: string) {
  const s = state.steps;
  const companyOurs = s.company.created === true && Boolean(s.company.gid);
  const step = async (action: string, gid: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action, subject: gid, detail: { undo: subject } });
    } catch (e) {
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action, subject: gid, result: "failed", detail: { undo: subject, code: errorCode(e).code } });
      throw e;
    }
  };
  // Tier first, so a market never keeps a location we are about to delete.
  if (s.tier.jobIds?.length) await db.job.deleteMany({ where: { shop: ctx.shop, id: { in: s.tier.jobIds }, state: "waiting" } });
  if (s.location.gid && (s.tier.status === "done" || s.tier.status === "failed" || s.tier.status === "running") && !s.tier.pendingAssignment) {
    const tier = await db.tier.findFirst({ where: { id: state.input.tierId, shop: ctx.shop } });
    if (tier) await step("tier.unassign", s.location.gid, () => moveLocations(ctx, [s.location.gid!], tier, null, { assignment: "auto" }));
  }
  if (!companyOurs) {
    if (s.contact.gid && s.contact.created)
      await step("approval.contact_removed", s.contact.gid, () => mutate(ctx.admin, "companyContactRemoveFromCompany", Q.contactRemove, { companyContactId: s.contact.gid }));
    if (s.location.gid && s.location.created)
      await step("approval.location_deleted", s.location.gid, () => mutate(ctx.admin, "companyLocationDelete", Q.locationDelete, { companyLocationId: s.location.gid }));
  } else {
    await step("approval.company_deleted", s.company.gid!, () => mutate(ctx.admin, "companyDelete", Q.companyDelete, { id: s.company.gid }));
  }
}

// ---------- defaults for the approve modal ----------

export type ApprovalDefaults = {
  input: ApproveInput;
  existingCustomer: { gid: string; name: string; email: string; otherCompany: string | null } | null;
  suggestedExemption: { exemption: string | null; reason: string };
  paymentTermsOptions: { id: string; name: string }[];
  tiers: { id: string; name: string }[];
  catalogBudget: { used: number | null; limit: number | null };
  // Additions beyond the contract:
  allExemptions: string[];
  tierDefaults: Record<string, { paymentTermsTemplateId: string | null; checkoutToDraft: boolean; tax: "charge" | "exempt_on_file" }>;
  contactEmail: string;
  contactName: string;
  state: ApprovalState | null;
  quota: { used: number; limit: number | null; blocked: boolean };
  useShopifyWelcome: boolean;
};

export async function approvalDefaults(ctx: ApprovalCtx, applicationId: string): Promise<ApprovalDefaults> {
  const app = await loadApp(ctx, applicationId);
  const [shopRow, tiers, certs, form] = await Promise.all([
    db.shop.findUnique({ where: { shop: ctx.shop } }),
    db.tier.findMany({ where: { shop: ctx.shop }, orderBy: { position: "asc" } }),
    db.certificate.findMany({ where: { shop: ctx.shop, applicationId: app.id }, orderBy: { createdAt: "desc" } }),
    app.formId ? db.form.findFirst({ where: { shop: ctx.shop, id: app.formId }, select: { suggestedTierId: true } }) : null,
  ]);
  const settings = readSettings(shopRow?.settings ?? {});
  const a = (app.answers ?? {}) as Record<string, unknown>;
  const billing = addressFromAnswers(a.billingAddress, app.countryCode) ?? { address1: "", city: "", countryCode: app.countryCode ?? "" };
  const shipping = addressFromAnswers(a.shippingAddress, app.countryCode);
  const tier: Tier | undefined =
    tiers.find((x) => x.id === app.suggestedTierId) ?? tiers.find((x) => x.id === form?.suggestedTierId) ?? tiers[0];
  const td = readDefaults(tier?.defaults);

  // Certificates outrank the billing state: a Texas certificate means the Texas exemption.
  const resale = certs.find((c) => c.type === "resale" && c.status !== "rejected");
  const suggestion = suggestExemption({
    storeCountry: shopRow?.country ?? "",
    buyerCountry: billing.countryCode || app.countryCode || "",
    buyerRegion: billing.zoneCode,
    certificateType: resale ? "resale" : certs[0] ? (certs[0].type as "vat") : null,
    certificateRegion: resale?.region ?? null,
    vatVerified: app.taxCheck === "verified",
  });

  let taxNumber: string | null = null;
  try {
    taxNumber = app.taxNumberEnc ? decrypt(app.taxNumberEnc) : null;
  } catch {
    taxNumber = null;
  }

  let existing: ApprovalDefaults["existingCustomer"] = null;
  try {
    const n = app.customerGid
      ? (await gql(ctx.admin, Q.customer, { id: app.customerGid })).customer
      : null;
    const cust = n ? toCustomer(n) : await findCustomerByEmail(ctx.admin, app.email);
    if (cust) existing = { gid: cust.gid, name: cust.name, email: cust.email, otherCompany: cust.companies[0]?.name ?? null };
  } catch {
    existing = null;
  }

  const contact = contactFromApp(app, { contact: { mode: "new" } } as ApproveInput);
  const [terms, budget, used] = await Promise.all([paymentTermsOptions(ctx.admin), catalogBudget(ctx.admin, ctx.shop), approvalsThisMonth(ctx.shop)]);
  const quota = approvalQuota(effectivePlan(shopRow?.billingPlan ?? "free", Boolean(shopRow?.isDevStore)), used);
  const prev = readState(app.approvalState);

  const input: ApproveInput = prev?.input ?? {
    tierId: tier?.id ?? "",
    paymentTermsTemplateId: td.paymentTermsTemplateId,
    taxExempt: td.tax === "exempt_on_file" && Boolean(suggestion.exemption),
    exemptions: suggestion.exemption ? [suggestion.exemption] : [],
    taxRegistrationId: taxNumber,
    companyName: app.companyName,
    locationName: billing.city ? `${app.companyName} – ${billing.city}` : app.companyName,
    billingAddress: { ...billing, company: billing.company ?? app.companyName },
    shippingAddress: shipping && validAddress(shipping) ? shipping : null,
    contact: existing ? { mode: "existing", customerGid: existing.gid } : { mode: "new" },
    sendWelcome: true,
    checkoutToDraft: td.checkoutToDraft,
  };

  return {
    input,
    existingCustomer: existing,
    suggestedExemption: suggestion,
    paymentTermsOptions: terms.map(({ id, name }) => ({ id, name })),
    tiers: tiers.map((x) => ({ id: x.id, name: x.name })),
    catalogBudget: { used: budget.used, limit: budget.direct ? null : budget.limit },
    allExemptions: TAX_EXEMPTIONS,
    tierDefaults: Object.fromEntries(tiers.map((x) => {
      const d = readDefaults(x.defaults);
      return [x.id, { paymentTermsTemplateId: d.paymentTermsTemplateId, checkoutToDraft: d.checkoutToDraft, tax: d.tax }];
    })),
    contactEmail: contact.email ?? "",
    contactName: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    state: prev,
    quota: { used: quota.used, limit: quota.limit, blocked: quota.blocked },
    useShopifyWelcome: settings.notifications.useShopifyWelcome,
  };
}

// ---------- bulk approve ----------

export type BulkApproveSummary = { approved: string[]; skipped: { id: string; company: string; reason: string }[] };

export async function approveMany(ctx: ApprovalCtx, ids: string[], tierId: string): Promise<BulkApproveSummary> {
  const t = await translator(ctx);
  const out: BulkApproveSummary = { approved: [], skipped: [] };
  let blocked = false;
  for (const id of ids) {
    const app = await db.application.findFirst({ where: { id, shop: ctx.shop }, select: { id: true, companyName: true, status: true } });
    if (!app) continue;
    const skip = (key: string, values?: Record<string, string>) => out.skipped.push({ id, company: app.companyName, reason: t(`approval.skip.${key}`, values) });
    if (blocked) { skip("plan_limit"); continue; }
    if (app.status !== "pending" && app.status !== "needs_info") { skip("not_pending"); continue; }
    try {
      const d = await approvalDefaults(ctx, id);
      const td = d.tierDefaults[tierId];
      if (!td) { skip("tier_missing"); continue; }
      const input: ApproveInput = { ...d.input, tierId, paymentTermsTemplateId: td.paymentTermsTemplateId, checkoutToDraft: td.checkoutToDraft };
      const state = await approveApplication(ctx, id, input);
      const failed = APPROVAL_STEPS.find((s) => state.steps[s].status === "failed");
      if (failed && failed !== "email") skip("step_failed", { step: t(`approval.step.${failed}`), error: state.steps[failed].error ?? "" });
      else out.approved.push(id);
    } catch (e) {
      if (e instanceof ApprovalError) {
        if (e.code === "plan_limit") blocked = true;
        skip(e.code);
      } else skip("step_failed", { step: "", error: t(`approval.error.${errorCode(e).code}`, { detail: "" }) });
    }
  }
  return out;
}

// ---------- import / tag conversion ----------

/** Create company + location + contact + terms/tax + tier without an application (CSV import, tag conversion). Same steps and verification as approval. */
export async function createBuyerFromInput(
  ctx: ApprovalCtx,
  input: ApproveInput & { source: "import" | "tag"; existingCompanyGid?: string; externalId?: string },
): Promise<{ buyerId: string; state: ApprovalState }> {
  checkInput(input);
  const c = input.contact.mode === "new" ? input.contact : null;
  const key = input.externalId ?? input.existingCompanyGid ??
    sha256(`${ctx.shop}|${input.companyName.toLowerCase()}|${c?.email?.toLowerCase() ?? (input.contact.mode === "existing" ? input.contact.customerGid : "")}`).slice(0, 24);
  const state: ApprovalState = { input, steps: emptySteps(), startedAt: new Date().toISOString() };
  const r: Run = {
    ctx, state, externalId: `tradepass-${input.source}-${key}`, existingCompanyGid: input.existingCompanyGid,
    email: c?.email ?? null, firstName: c?.firstName, lastName: c?.lastName, phone: c?.phone, locale: c?.locale ?? "en",
    save: async () => undefined, // re-running finds the same objects by externalId
  };
  const finalize = async (run: Run) => {
    const companyGid = run.state.steps.company.gid!;
    const loc = run.state.steps.location.gid!;
    const prev = await db.buyer.findUnique({ where: { shop_companyGid: { shop: ctx.shop, companyGid } } });
    const buyer = prev
      ? await db.buyer.update({
          where: { id: prev.id },
          data: { tierId: input.tierId, locationGids: [...new Set([...prev.locationGids, loc])], contactGid: run.state.steps.contact.gid ?? prev.contactGid },
        })
      : await db.buyer.create({
          data: {
            shop: ctx.shop, companyGid, locationGids: [loc], contactGid: run.state.steps.contact.gid ?? null, tierId: input.tierId,
            taxExemptions: input.taxExempt ? input.exemptions : [], country: input.billingAddress.countryCode, source: input.source, name: input.companyName,
          },
        });
    run.state.buyerId = buyer.id;
    await attachJobsToBuyer(ctx.shop, run.state.steps.tier.jobIds, buyer.id);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: `buyer.create_${input.source}`, subject: buyer.id, detail: { companyGid, tierId: input.tierId } });
  };
  await runSteps(r, finalize);
  const failed = APPROVAL_STEPS.find((s) => state.steps[s].status === "failed" && s !== "email");
  if (failed || !state.buyerId) throw Object.assign(new Error(state.steps[failed ?? "company"].error ?? "failed"), { state, step: failed });
  return { buyerId: state.buyerId, state };
}

// ---------- hourly: retry stuck approvals ----------

/** Applications whose approval stopped on a transient error (or crashed mid-step) — safe to continue automatically. */
export function isSafeToRetry(state: ApprovalState | null, now = Date.now()): boolean {
  if (!state || state.finishedAt || (state.autoRetries ?? 0) >= 3) return false;
  return APPROVAL_STEPS.some((s) => {
    const st = state.steps[s];
    if (st.status === "failed") return TRANSIENT_CODES.has(st.code ?? "") || s === "email";
    if (st.status === "running") return now - Date.parse(state.startedAt) > 10 * 60_000;
    return false;
  });
}

export async function retryStuckApprovals(deadline: number, adminFor: (shop: string) => Promise<Admin>): Promise<number> {
  const rows = await db.application.findMany({
    where: { status: { in: ["pending", "needs_info", "approved"] }, approvalState: { not: Prisma.DbNull } },
    select: { id: true, shop: true, approvalState: true },
    take: 50,
  });
  let n = 0;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    const state = readState(row.approvalState);
    if (!isSafeToRetry(state)) continue;
    await db.application.update({ where: { id: row.id }, data: { approvalState: { ...state!, autoRetries: (state!.autoRetries ?? 0) + 1 } as unknown as Prisma.InputJsonValue } });
    try {
      await retryApproval({ admin: await adminFor(row.shop), shop: row.shop, actor: "system" }, row.id);
      n++;
    } catch {
      // stays visible in the app with Retry / Undo
    }
  }
  return n;
}
