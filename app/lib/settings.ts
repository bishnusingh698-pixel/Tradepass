// Shop settings: one versioned JSON blob on Shop.settings. Always read through
// `readSettings`, which fills defaults so older rows keep working after we add
// fields. Bump SETTINGS_VERSION and add a migration step only when a field's
// meaning changes (adding fields needs no migration). Keys that are no longer
// part of Settings (e.g. the old email `notifications` and `branding` blocks)
// are dropped on read, so stored settings from older versions keep loading.

export const SETTINGS_VERSION = 1;

export type AccessMode = "show" | "hide" | "wholesale_only";
export type ScopeType = "all" | "collections" | "products" | "tags";
export type Audience = "retail" | "salon" | "restaurant" | "distributor" | "reseller" | "nonprofit" | "other";
/** all = anyone; allow = only the listed countries; block = everyone except the listed countries. */
export type CountryRule = { mode: "all" | "allow" | "block"; list: string[] };

/** Per-locale merchant text: { locale: { key: text } } */
export type LocalizedTexts = Record<string, Record<string, string>>;

export type Settings = {
  welcome: { audience: Audience | null; done: boolean };
  /** Who may apply, by billing country. Enforced by the storefront form and again on the server. */
  applications: { countries: CountryRule };
  storefront: {
    accessMode: AccessMode;
    scope: { type: ScopeType; ids: string[]; tags: string[] };
    showApplyBanner: boolean;
    applyUrl: string; // where "Apply for wholesale" points
    loginUrl: string; // customer accounts sign-in
    showPriceHint: boolean;
    colors: { button: string | null; text: string | null }; // null = inherit theme
    customSelectors: { price: string; addToCart: string; productCard: string };
    hidePages: string[]; // handles of pages/collections hidden from non-B2B in wholesale-only mode
    exemptCustomerTags: string[]; // wholesale-only: customers with these tags may check out (e.g. staff draft orders)
  };
  /** expiringDays: when a certificate counts as "Expiring soon"; onExpiry: what happens to the tax exemption once it has expired. */
  certificates: { expiringDays: number; onExpiry: "ask" | "remove" };
  automation: { paused: boolean; dailyLimit: number };
  /** auto = Tradepass moves locations between B2B markets; assisted = merchant does it from a checklist (Phase 0 fallback). */
  tiers: { assignment: "auto" | "assisted" };
  retention: { months: number; deleteFiles: boolean };
  /** Merchant overrides for any built-in text, admin/messages/storefront: { locale: { key: text } } */
  texts: LocalizedTexts;
  /** formReviewed / storefrontReviewed turn the matching checklist steps green once the merchant saved that page. */
  onboarding: { checklistDismissed: boolean; dismissedAlerts: Record<string, string>; formReviewed: boolean; storefrontReviewed: boolean };
  debug: { storefrontUntil: string | null };
};

export function defaultSettings(): Settings {
  return {
    welcome: { audience: null, done: false },
    applications: { countries: { mode: "all", list: [] } },
    storefront: {
      accessMode: "show",
      scope: { type: "all", ids: [], tags: [] },
      showApplyBanner: true,
      applyUrl: "/pages/wholesale",
      loginUrl: "/account/login",
      showPriceHint: false,
      colors: { button: null, text: null },
      customSelectors: { price: "", addToCart: "", productCard: "" },
      hidePages: [],
      exemptCustomerTags: [],
    },
    certificates: { expiringDays: 30, onExpiry: "ask" },
    automation: { paused: false, dailyLimit: 25 },
    tiers: { assignment: "auto" },
    retention: { months: 12, deleteFiles: true },
    texts: {},
    onboarding: { checklistDismissed: false, dismissedAlerts: {}, formReviewed: false, storefrontReviewed: false },
    debug: { storefrontUntil: null },
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge stored values over defaults; arrays and scalars from `stored` win, unknown keys are dropped. */
function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (!isObj(defaults) || !isObj(stored)) return (stored === undefined ? defaults : (stored as T));
  const out: Obj = { ...(defaults as Obj) };
  for (const key of Object.keys(defaults as Obj)) {
    const d = (defaults as Obj)[key];
    const s = (stored as Obj)[key];
    if (s === undefined) continue;
    // Free-form maps (texts, dismissedAlerts) keep every stored key.
    out[key] = isObj(d) && Object.keys(d).length === 0 ? s : mergeDefaults(d, s);
  }
  return out as T;
}

export function readSettings(stored: unknown): Settings {
  return mergeDefaults(defaultSettings(), stored);
}

/** Apply a partial update (deep) and return the full settings. */
export function patchSettings(current: Settings, patch: DeepPartial<Settings>): Settings {
  // Merge against the defaults (not `current`), so free-form maps like `texts` keep new keys.
  return mergeDefaults(defaultSettings(), deepAssign(structuredClone(current) as unknown as Obj, patch as Obj));
}

function deepAssign(target: Obj, patch: Obj): Obj {
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(target[k])) deepAssign(target[k] as Obj, v);
    else target[k] = v;
  }
  return target;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

/** Whether an applicant's billing country may apply under the merchant's country rule. Unknown country: allowed (the form asks for it). */
export function countryAllowed(rule: CountryRule, country: string | null | undefined): boolean {
  if (!country || rule.mode === "all") return true;
  const listed = rule.list.includes(country.toUpperCase());
  return rule.mode === "allow" ? listed : !listed;
}
