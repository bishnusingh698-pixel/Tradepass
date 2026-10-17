// Applications queue constants shared by the server and the queue page.
export const TABS = ["pending", "needs_info", "approved", "rejected", "all"] as const;
export type Tab = (typeof TABS)[number];
