import * as tiers from "./tiers";
import * as certificates from "./certificates";
import * as imports from "./imports";
import * as storefront from "./storefront";
import * as background from "./background";

const areas = [background, tiers, imports, storefront, certificates];

export const areaHourly = areas.flatMap((a) => a.hourly);
export const areaDaily = areas.flatMap((a) => a.daily);
