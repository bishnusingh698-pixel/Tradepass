import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { adminContext } from "../lib/context.server";
import {
  ApprovalError, approvalDefaults, approveApplication, retryApproval, undoApproval, type ApproveInput,
} from "../lib/approval.server";
import db from "../db.server";

// Resource route (no UI) for the approve modal:
// GET  → defaults for the form (also polled for live step progress while an approval runs)
// POST intent=approve (input JSON) | retry | undo → the approval state.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  if (url.searchParams.get("progress") === "1") {
    // Cheap poll: our DB only, no Shopify calls.
    const app = await db.application.findFirst({ where: { id: params.id!, shop: ctx.shop }, select: { approvalState: true, status: true } });
    return { progress: app?.approvalState ?? null, status: app?.status ?? null };
  }
  try {
    return { defaults: await approvalDefaults({ admin: ctx.admin, shop: ctx.shop, actor: ctx.actor, t: ctx.t }, params.id!) };
  } catch (e) {
    if (e instanceof ApprovalError) return { error: e.code, message: ctx.t(`approval.blocked.${e.code}`) };
    throw e;
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor, t: ctx.t };
  try {
    if (intent === "approve") {
      const input = JSON.parse(String(form.get("input") ?? "{}")) as ApproveInput;
      return { ok: true as const, state: await approveApplication(actx, params.id!, input) };
    }
    if (intent === "retry") return { ok: true as const, state: await retryApproval(actx, params.id!) };
    if (intent === "undo") {
      await undoApproval(actx, params.id!);
      return { ok: true as const, state: null, undone: true };
    }
    return { ok: false as const, error: "unknown_intent", message: ctx.t("errors.generic") };
  } catch (e) {
    if (e instanceof ApprovalError) return { ok: false as const, error: e.code, message: ctx.t(`approval.blocked.${e.code}`) };
    return { ok: false as const, error: "failed", message: ctx.t("approval.blocked.failed") };
  }
};
