import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { adminContext } from "../lib/context.server";
import db from "../db.server";
import { createForm, listForms } from "../lib/forms.server";
import { logActivity } from "../lib/activity.server";
import { can } from "../lib/plans";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { AddToPage } from "../components/form-builder/AddToPage";
import { Modal, TextInput, flag } from "../components/form-builder/wc";
import { LIMITS } from "../components/form-builder/model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, plan } = await adminContext(request);
  const [forms, tiers] = await Promise.all([
    listForms(shop),
    db.tier.findMany({ where: { shop }, select: { id: true, name: true } }),
  ]);
  return {
    forms: forms.map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString() })),
    tiers: Object.fromEntries(tiers.map((x) => [x.id, x.name])),
    canMultiple: can(plan, "multiple_forms"),
    shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, plan, actor, redirect } = await adminContext(request);
  const form = await request.formData();
  if (form.get("intent") !== "create") return { ok: false as const, error: "invalid" };
  const res = await createForm(shop, plan, String(form.get("name") ?? ""));
  if ("error" in res) return { ok: false as const, error: res.error };
  await logActivity({ shop, actor, action: "form.created", subject: res.id });
  const loc = new URL(request.url).searchParams.get("locale");
  return redirect(`/app/form/${res.id}${loc ? `?${new URLSearchParams({ locale: loc })}` : ""}`);
};

export default function Forms() {
  const { forms, tiers, canMultiple, shop, apiKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const busy = fetcher.state !== "idle";
  const nameError = touched && !name.trim() ? t("form.list.nameRequired") : fetcher.data && !fetcher.data.ok && fetcher.data.error === "name" ? t("form.list.nameRequired") : undefined;

  const add = () => {
    setTouched(true);
    if (!name.trim()) return;
    fetcher.submit({ intent: "create", name }, { method: "post" });
  };

  return (
    <s-page heading={t("form.title")}>
      <s-button slot="primary-action" variant="primary" {...flag("disabled", !canMultiple)} onClick={() => setAdding(true)}>
        {t("form.list.add")}
      </s-button>
      {!canMultiple && (
        <s-banner tone="info">{t("form.list.proNote", { plan: "Pro" })} {t("common.availableOn", { plan: "Pro" })}</s-banner>
      )}
      <s-section padding="none" accessibilityLabel={t("form.list.tableLabel")}>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("form.list.name")}</s-table-header>
            <s-table-header>{t("form.list.fields")}</s-table-header>
            <s-table-header>{t("form.list.tier")}</s-table-header>
            <s-table-header>{t("form.list.updated")}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {forms.map((f) => (
              <s-table-row key={f.id}>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-link href={href(`/app/form/${f.id}`)}>{f.name}</s-link>
                    {f.isDefault && <s-badge>{t("form.list.default")}</s-badge>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{t("form.list.fieldCount", { count: f.fieldCount })}</s-table-cell>
                <s-table-cell>{f.suggestedTierId ? tiers[f.suggestedTierId] ?? "—" : t("form.list.noTier")}</s-table-cell>
                <s-table-cell>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(f.updatedAt))}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <AddToPage shop={shop} apiKey={apiKey} />

      <Modal id="form-add-modal" heading={t("form.list.addHeading")} open={adding} onClose={() => setAdding(false)}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("form.list.addBody")}</s-paragraph>
          {fetcher.data && !fetcher.data.ok && fetcher.data.error === "plan" && (
            <s-banner tone="warning">{t("common.availableOn", { plan: "Pro" })}</s-banner>
          )}
          <TextInput
            id="form-add-name"
            label={t("form.settings.name")}
            value={name}
            maxLength={LIMITS.formName}
            placeholder={t("form.list.namePlaceholder")}
            error={nameError}
            onBlur={() => setTouched(true)}
            onChange={setName}
          />
        </s-stack>
        <s-button slot="primary-action" variant="primary" onClick={add} {...flag("loading", busy)}>
          {t("form.list.create")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => setAdding(false)}>
          {t("common.cancel")}
        </s-button>
      </Modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
