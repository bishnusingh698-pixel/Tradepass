import { useState, type DragEvent } from "react";
import { BUSINESS_TYPES, type FieldType, type FieldTexts, type FormDefinition, type FormField, type FormSection } from "../../lib/form-defaults";
import { useI18n } from "../../lib/i18n/react";
import {
  CHOICE_TYPES, CUSTOM_FIELD_TYPES, LIMITS, allFields, fieldAnchor, findField, isLocked, moveField, moveSection,
  nextCustomId, optionValueFrom, placeField, removeField, setFieldText, updateField, type FormError,
} from "./model";
import { CheckboxInput, Modal, SelectInput, TextInput, flag } from "./wc";

type Texts = Record<string, string>;

/** Option values that ship with admin names (form-defaults.ts); merchant-added ones use their own text. */
const BUILT_IN_OPTIONS: Record<string, readonly string[]> = {
  businessType: BUSINESS_TYPES,
  monthlyOrderValue: ["lt1k", "1k-5k", "5k-20k", "gt20k"],
};

export type BuilderProps = {
  definition: FormDefinition;
  onChange: (next: FormDefinition) => void;
  /** Language being edited (also the preview language). */
  locale: string;
  /** Built-in storefront strings for `locale`, used as placeholders ("leave empty to use the default"). */
  defaults: Texts;
  /** Errors to show now (only for fields the merchant touched, or all after a save attempt). */
  errors: FormError[];
  onTouch: (anchor: string) => void;
};

/** Storefront locale keys for built-in texts (shared with the theme extension's locale files). */
export const sfKey = {
  field: (id: string, part: keyof FieldTexts) => `form.field.${id}.${part}`,
  option: (id: string, value: string) =>
    id === "businessType" ? `form.business_type.${value}` : id === "monthlyOrderValue" ? `form.order_value.${value}` : `form.field.${id}.option.${value}`,
  section: (id: string) => `form.section.${id}`,
  consent: "form.field.consent.label",
  success: "form.success.body",
};

export function useFieldName(defaults: Texts, locale: string) {
  const { t } = useI18n();
  return (f: FormField) =>
    f.texts?.[locale]?.label ||
    (f.custom
      ? Object.values(f.texts ?? {}).find((x) => x.label)?.label || t("form.field.untitled")
      : defaults[sfKey.field(f.id, "label")] || t(`form.fieldName.${f.id}`));
}

export function useErrorText(defaults: Texts, locale: string, def: FormDefinition) {
  const { t } = useI18n();
  const name = useFieldName(defaults, locale);
  return (e: FormError) => {
    const f = e.fieldId ? findField(def, e.fieldId) : undefined;
    const field = f ? name(f) : e.fieldId ? t(`form.fieldName.${e.fieldId}`) : "";
    return t(`form.error.${e.code}`, { field, ...(e.values ?? {}) });
  };
}

export function FormBuilder(p: BuilderProps) {
  const { t } = useI18n();
  const name = useFieldName(p.defaults, p.locale);
  const errorText = useErrorText(p.defaults, p.locale, p.definition);
  const [open, setOpen] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [newType, setNewType] = useState<FieldType>("text");
  const [newSection, setNewSection] = useState(p.definition.sections[0]?.id ?? "business");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const errAt = (anchor: string) => {
    const e = p.errors.find((x) => x.anchor === anchor);
    return e ? errorText(e) : undefined;
  };
  const rowErrors = (id: string) => p.errors.filter((e) => e.fieldId === id);
  const def = p.definition;

  const addField = () => {
    const id = nextCustomId(def);
    const field: FormField = { id, type: newType, state: "optional", custom: true };
    if (CHOICE_TYPES.includes(newType)) field.options = [];
    const next = structuredClone(def);
    (next.sections.find((s) => s.id === newSection) ?? next.sections[0]).fields.push(field);
    p.onChange(next);
    setOpen(id);
  };

  const onDrop = (e: DragEvent, section: FormSection, beforeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragId) p.onChange(placeField(def, dragId, section.id, beforeId));
    setDragId(null);
  };

  const sectionTitle = (s: FormSection) => s.texts?.[p.locale]?.title || t(`form.sectionName.${s.id}`);

  return (
    <s-stack direction="block" gap="base" id="fb-sections">
      {def.sections.map((section, si) => (
        <s-section key={section.id} heading={sectionTitle(section)}>
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-box inlineSize="100%" maxInlineSize="420px">
                <TextInput
                  id={`fb-section-${section.id}-title`}
                  label={t("form.section.titleLabel")}
                  value={section.texts?.[p.locale]?.title ?? ""}
                  placeholder={p.defaults[sfKey.section(section.id)] ?? t(`form.sectionName.${section.id}`)}
                  maxLength={LIMITS.label}
                  onChange={(v) => {
                    const next = structuredClone(def);
                    const s = next.sections[si];
                    const texts = (s.texts ??= {});
                    if (v) texts[p.locale] = { title: v };
                    else delete texts[p.locale];
                    if (!Object.keys(texts).length) delete s.texts;
                    p.onChange(next);
                  }}
                />
              </s-box>
              <s-button icon="arrow-up" variant="tertiary" accessibilityLabel={t("form.section.moveUp", { section: sectionTitle(section) })} {...flag("disabled", si === 0)} onClick={() => p.onChange(moveSection(def, section.id, -1))} />
              <s-button icon="arrow-down" variant="tertiary" accessibilityLabel={t("form.section.moveDown", { section: sectionTitle(section) })} {...flag("disabled", si === def.sections.length - 1)} onClick={() => p.onChange(moveSection(def, section.id, 1))} />
            </s-stack>

            <div role="list" aria-label={sectionTitle(section)} onDragOver={(e) => dragId && e.preventDefault()} onDrop={(e) => onDrop(e, section, null)} style={{ minHeight: 24 }}>
              {section.fields.length === 0 && <s-text tone="neutral">{t("form.section.empty")}</s-text>}
              {section.fields.map((f) => {
                const errs = rowErrors(f.id);
                return (
                  <div
                    key={f.id}
                    role="listitem"
                    id={fieldAnchor(f.id)}
                    tabIndex={-1}
                    draggable
                    onDragStart={(e) => {
                      setDragId(f.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", f.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => dragId && e.preventDefault()}
                    onDrop={(e) => onDrop(e, section, f.id)}
                    style={{ opacity: dragId === f.id ? 0.5 : 1, marginBlockEnd: 8 }}
                  >
                    <s-box padding="small-200" border="base" borderRadius="base" background={errs.length ? "subdued" : "base"}>
                      <s-stack direction="block" gap="small">
                        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                          <s-stack direction="inline" gap="small" alignItems="center">
                            <span style={{ cursor: "grab" }} aria-hidden="true"><s-icon type="drag-handle" /></span>
                            <s-text type="strong">{name(f)}</s-text>
                            <s-badge tone={f.state === "required" ? "info" : f.state === "hidden" ? "neutral" : "auto"}>{t(`form.state.${f.state}`)}</s-badge>
                            {f.custom && <s-badge>{t(`form.type.${f.type}`)}</s-badge>}
                            {f.showIf && <s-badge icon="view">{t("form.field.conditional")}</s-badge>}
                            {errs.length > 0 && <s-badge tone="critical">{t("form.field.hasErrors", { count: errs.length })}</s-badge>}
                          </s-stack>
                          <s-stack direction="inline" gap="small-300" alignItems="center">
                            <s-button icon="arrow-up" variant="tertiary" accessibilityLabel={t("form.field.moveUp", { field: name(f) })} onClick={() => p.onChange(moveField(def, f.id, -1))} />
                            <s-button icon="arrow-down" variant="tertiary" accessibilityLabel={t("form.field.moveDown", { field: name(f) })} onClick={() => p.onChange(moveField(def, f.id, 1))} />
                            <s-button variant="tertiary" icon={open === f.id ? "chevron-up" : "edit"} onClick={() => setOpen(open === f.id ? null : f.id)}>
                              {open === f.id ? t("form.field.close") : t("form.field.edit")}
                            </s-button>
                          </s-stack>
                        </s-stack>
                        {open === f.id && (
                          <FieldEditor
                            field={f}
                            def={def}
                            locale={p.locale}
                            defaults={p.defaults}
                            name={name}
                            errAt={errAt}
                            onTouch={p.onTouch}
                            onChange={p.onChange}
                            onDelete={() => setConfirmDelete(f.id)}
                          />
                        )}
                      </s-stack>
                    </s-box>
                  </div>
                );
              })}
            </div>
          </s-stack>
        </s-section>
      ))}

      <s-section heading={t("form.add.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("form.add.body")}</s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base" alignItems="end">
            <SelectInput
              id="fb-add-type"
              label={t("form.add.type")}
              value={newType}
              options={CUSTOM_FIELD_TYPES.map((x) => ({ value: x, label: t(`form.type.${x}`) }))}
              onChange={(v) => setNewType(v as FieldType)}
            />
            <SelectInput
              id="fb-add-section"
              label={t("form.add.section")}
              value={newSection}
              options={def.sections.map((s) => ({ value: s.id, label: sectionTitle(s) }))}
              onChange={setNewSection}
            />
            <s-button id="fb-add-field" icon="plus" onClick={addField} {...flag("disabled", allFields(def).length >= LIMITS.fields)}>
              {t("form.add.button")}
            </s-button>
          </s-grid>
          {errAt("fb-add-field") && <s-text tone="critical">{errAt("fb-add-field")}</s-text>}
        </s-stack>
      </s-section>

      <Modal id="fb-delete-modal" heading={t("form.delete.heading")} open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <s-paragraph>
          {t("form.delete.body", { field: confirmDelete ? name(findField(def, confirmDelete) ?? ({ id: confirmDelete } as FormField)) : "" })}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={() => {
            if (confirmDelete) p.onChange(removeField(def, confirmDelete));
            setConfirmDelete(null);
          }}
        >
          {t("form.delete.confirm")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => setConfirmDelete(null)}>
          {t("common.cancel")}
        </s-button>
      </Modal>
    </s-stack>
  );
}

function FieldEditor({
  field: f, def, locale, defaults, name, errAt, onTouch, onChange, onDelete,
}: {
  field: FormField;
  def: FormDefinition;
  locale: string;
  defaults: Texts;
  name: (f: FormField) => string;
  errAt: (anchor: string) => string | undefined;
  onTouch: (anchor: string) => void;
  onChange: (next: FormDefinition) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const locked = isLocked(f.id);
  const texts = f.texts?.[locale] ?? {};
  const fields = allFields(def);
  const index = fields.findIndex((x) => x.id === f.id);
  // "Show if" can only point at an earlier choice field (the applicant answers it first).
  const sources = fields.slice(0, index).filter((x) => CHOICE_TYPES.includes(x.type) && x.options?.length && x.state !== "hidden");
  const source = f.showIf ? fields.find((x) => x.id === f.showIf!.field) : undefined;
  const hasOptions = CHOICE_TYPES.includes(f.type) && f.id !== "preferredLanguage";
  const optionLabel = (fl: FormField, value: string) =>
    fl.options?.find((o) => o.value === value)?.texts?.[locale] ||
    defaults[sfKey.option(fl.id, value)] ||
    Object.values(fl.options?.find((o) => o.value === value)?.texts ?? {})[0] ||
    (!fl.custom && BUILT_IN_OPTIONS[fl.id]?.includes(value) ? t(`form.option.${fl.id}.${value}`) : value);
  const text = (part: keyof FieldTexts, label: string, max: number, rows?: number) => {
    const anchor = fieldAnchor(f.id, part);
    return (
      <TextInput
        id={anchor}
        label={label}
        value={texts[part] ?? ""}
        placeholder={f.custom ? "" : defaults[sfKey.field(f.id, part)] ?? ""}
        details={f.custom ? undefined : t("form.field.defaultHint")}
        maxLength={max}
        rows={rows}
        error={part === "label" ? errAt(anchor) : undefined}
        onBlur={() => onTouch(anchor)}
        onChange={(v) => onChange(setFieldText(def, f.id, locale, part, v))}
      />
    );
  };

  return (
    <s-stack direction="block" gap="base">
      <SelectInput
        id={fieldAnchor(f.id, "state")}
        label={t("form.field.state")}
        value={f.state}
        details={locked ? t("form.field.lockedHint") : undefined}
        options={(["required", "optional", "hidden"] as const)
          .filter((s) => !(locked && s === "hidden"))
          .map((s) => ({ value: s, label: t(`form.state.${s}`) }))}
        onChange={(v) => onChange(updateField(def, f.id, { state: v as FormField["state"] }))}
      />
      {f.type === "consent" ? <s-text tone="neutral">{t("form.field.consentHint")}</s-text> : text("label", t("form.field.label"), LIMITS.label)}
      {f.type !== "consent" && f.type !== "address" && f.type !== "file" && f.type !== "checkboxes" && text("placeholder", t("form.field.placeholder"), LIMITS.placeholder)}
      {text("help", t("form.field.help"), LIMITS.help, 2)}

      {hasOptions && (
        <s-stack direction="block" gap="small" id={fieldAnchor(f.id, "options")}>
          <s-heading>{t("form.options.heading")}</s-heading>
          {(f.options ?? []).length === 0 && <s-text tone="neutral">{t("form.options.empty")}</s-text>}
          {(f.options ?? []).map((o, oi) => (
            <s-stack key={o.value} direction="inline" gap="small" alignItems="end">
              <s-box inlineSize="100%" maxInlineSize="360px">
                <TextInput
                  label={t("form.options.label", { n: oi + 1 })}
                  value={o.texts?.[locale] ?? ""}
                  placeholder={f.custom ? "" : optionLabel(f, o.value)}
                  maxLength={LIMITS.option}
                  onChange={(v) => {
                    const next = structuredClone(def);
                    const opt = findField(next, f.id)!.options![oi];
                    const ot = (opt.texts ??= {});
                    if (v) ot[locale] = v;
                    else delete ot[locale];
                    if (!Object.keys(ot).length) delete opt.texts;
                    onChange(next);
                  }}
                />
              </s-box>
              <s-button
                icon="delete"
                variant="tertiary"
                accessibilityLabel={t("form.options.remove", { option: optionLabel(f, o.value) })}
                onClick={() => {
                  const next = structuredClone(def);
                  const fl = findField(next, f.id)!;
                  fl.options = fl.options!.filter((x) => x.value !== o.value);
                  // A condition on a removed option could never match.
                  for (const x of allFields(next)) if (x.showIf?.field === f.id && x.showIf.equals === o.value) delete x.showIf;
                  onChange(next);
                }}
              />
            </s-stack>
          ))}
          <AddOption
            onAdd={(label) => {
              const next = structuredClone(def);
              const fl = findField(next, f.id)!;
              const value = optionValueFrom(label, (fl.options ?? []).map((o) => o.value));
              (fl.options ??= []).push({ value, texts: { [locale]: label } });
              onChange(next);
            }}
          />
          {errAt(fieldAnchor(f.id, "options")) && <s-text tone="critical">{errAt(fieldAnchor(f.id, "options"))}</s-text>}
        </s-stack>
      )}

      {!locked && (
        <s-stack direction="block" gap="small" id={fieldAnchor(f.id, "showif")}>
          <CheckboxInput
            label={t("form.showIf.toggle")}
            checked={Boolean(f.showIf)}
            disabled={!f.showIf && sources.length === 0}
            details={sources.length === 0 && !f.showIf ? t("form.showIf.noSources") : undefined}
            onChange={(on) => {
              const first = sources[0];
              onChange(updateField(def, f.id, { showIf: on && first ? { field: first.id, equals: first.options![0].value } : undefined }));
            }}
          />
          {f.showIf && (
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
              <SelectInput
                label={t("form.showIf.field")}
                value={f.showIf.field}
                options={[
                  ...sources.map((x) => ({ value: x.id, label: name(x) })),
                  ...(source && !sources.includes(source) ? [{ value: source.id, label: name(source) }] : []),
                  ...(!source ? [{ value: f.showIf.field, label: t("form.showIf.missing") }] : []),
                ]}
                onChange={(v) => {
                  const src = fields.find((x) => x.id === v);
                  onChange(updateField(def, f.id, { showIf: { field: v, equals: src?.options?.[0]?.value ?? "" } }));
                }}
              />
              <SelectInput
                label={t("form.showIf.equals")}
                value={f.showIf.equals}
                options={(source?.options ?? []).map((o) => ({ value: o.value, label: optionLabel(source!, o.value) }))}
                onChange={(v) => onChange(updateField(def, f.id, { showIf: { field: f.showIf!.field, equals: v } }))}
              />
            </s-grid>
          )}
          {errAt(fieldAnchor(f.id, "showif")) && <s-text tone="critical">{errAt(fieldAnchor(f.id, "showif"))}</s-text>}
        </s-stack>
      )}

      {f.custom && (
        <s-stack direction="inline">
          <s-button tone="critical" variant="tertiary" icon="delete" onClick={onDelete}>
            {t("form.field.delete")}
          </s-button>
        </s-stack>
      )}
    </s-stack>
  );
}

function AddOption({ onAdd }: { onAdd: (label: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const add = () => {
    if (!value.trim()) return;
    onAdd(value.trim());
    setValue("");
  };
  return (
    <s-stack direction="inline" gap="small" alignItems="end">
      <s-box inlineSize="100%" maxInlineSize="360px">
        <TextInput label={t("form.options.new")} value={value} maxLength={LIMITS.option} onChange={setValue} />
      </s-box>
      <s-button icon="plus" onClick={add} {...flag("disabled", !value.trim())}>
        {t("form.options.add")}
      </s-button>
    </s-stack>
  );
}
