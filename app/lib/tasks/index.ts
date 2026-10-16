import * as tiers from "./tiers";
import * as emails from "./emails";
import * as certificates from "./certificates";
import * as imports from "./imports";
import * as storefront from "./storefront";

const areas = [tiers, imports, storefront, certificates, emails];

// Emails run last so messages queued by earlier tasks go out in the same run.
export const areaHourly = areas.flatMap((a) => a.hourly);
export const areaDaily = areas.flatMap((a) => a.daily);
