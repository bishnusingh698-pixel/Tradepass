import type { Task } from "../jobs.server";

// Scheduled work for the certificates area. Each task: small batches, idempotent, respects `deadline`.
export const hourly: Task[] = [];
export const daily: Task[] = [];
