import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loader as healthz } from "../app/routes/healthz";
import { jobAuthorized, runTasks } from "../app/lib/jobs.server";

describe("/healthz", () => {
  it("returns 200 immediately", async () => {
    const res = healthz();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
  it("never imports the database (acceptance 25)", () => {
    const src = readFileSync("app/routes/healthz.tsx", "utf8");
    expect(src).not.toMatch(/^\s*import /m);
  });
});

describe("/jobs auth and budget", () => {
  it("requires the shared secret", () => {
    process.env.JOB_SECRET = "s3cret";
    const req = (h?: string) => new Request("https://x/jobs/hourly", { method: "POST", headers: h ? { "x-tradepass-job-secret": h } : {} });
    expect(jobAuthorized(req())).toBe(false);
    expect(jobAuthorized(req("wrong!"))).toBe(false);
    expect(jobAuthorized(req("s3cret"))).toBe(true);
  });
  it("isolates task failures and skips tasks once the time budget is gone", async () => {
    const r = await runTasks([
      { name: "a", run: async () => 3 },
      { name: "b", run: async () => { throw new Error("boom"); } },
    ]);
    expect(r.map((x) => [x.task, x.processed, x.error ?? null])).toEqual([["a", 3, null], ["b", 0, "boom"]]);
    const late = await runTasks([{ name: "c", run: async () => 1 }], Date.now() - 200_000);
    expect(late[0].error).toMatch(/time budget/);
  });
});
