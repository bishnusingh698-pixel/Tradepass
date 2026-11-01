// Calendar dates typed by people (YYYY-MM-DD). JavaScript rolls impossible
// dates over ("2027-02-31" becomes 3 March), so a date is valid only if it
// survives a round trip.

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date such as 2027-02-28 (and false for 2027-02-31 or 2027-13-01). */
export function isRealDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
