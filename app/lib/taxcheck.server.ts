// CONTRACT (owner: storefront area). Implementation replaces the stub body.
export type TaxCheck = { status: "verified" | "not_verified" | "unavailable" | "na"; name?: string; registry?: string };

/** Check a tax number against free official registries (VIES, optionally HMRC/ABN). Never throws; times out to "unavailable". */
export async function checkTaxNumber(_country: string, _number: string): Promise<TaxCheck> {
  return { status: "na" };
}
