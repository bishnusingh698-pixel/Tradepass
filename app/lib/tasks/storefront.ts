import type { Task } from "../jobs.server";

// Scheduled work for the storefront area. Each task: small batches, idempotent, respects `deadline`.
export const hourly: Task[] = [];
export const daily: Task[] = [];
