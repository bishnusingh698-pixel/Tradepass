import type { FormDefinition } from "../../lib/form-defaults";
import { useI18n } from "../../lib/i18n/react";
import { LIMITS } from "./model";
import { sfKey } from "./Builder";
import { CheckboxInput, TextInput } from "./wc";

type Props = {
  definition: FormDefinition;
  onChange: (next: FormDefinition) => void;
  locale: string;
  defaults: Record<string, string>;
  errAt: (anchor: string) => string | undefined;
  onTouch: (anchor: string) => void;
};

function setLocaleText(map: Record<string, string>, locale: string, value: string) {
  if (value) map[locale] = value;
  else delete map[locale];
}

/** Consent text + privacy link, success message + redirect, and the optional spam question. */
export function FormExtras({ definition: def, onChange, locale, defaults, errAt, onTouch }: Props) {
  const { t } = useI18n();
  const edit = (fn: (d: FormDefinition) => void) => {
    const next = structuredClone(def);
    fn(next);
    onChange(next);
  };
  const spam = def.spamQuestion.texts[locale] ?? { question: "", answer: "" };
  const setSpam = (key: "question" | "answer", value: string) =>
    edit((d) => {
      const entry = { ...(d.spamQuestion.texts[locale] ?? { question: "", answer: "" }), [key]: value };
      if (entry.question || entry.answer) d.spamQuestion.texts[locale] = entry;
      else delete d.spamQuestion.texts[locale];
    });

  return (
    <>
      <s-section heading={t("form.consent.heading")}>
        <s-stack direction="block" gap="base">
          <TextInput
            id="fb-consent-text"
            label={t("form.consent.text")}
            rows={3}
            value={def.consent.texts[locale] ?? ""}
            placeholder={defaults[sfKey.consent] ?? ""}
            details={t("form.field.defaultHint")}
            maxLength={LIMITS.consent}
            error={errAt("fb-consent-text")}
            onBlur={() => onTouch("fb-consent-text")}
            onChange={(v) => edit((d) => setLocaleText(d.consent.texts, locale, v))}
          />
          <TextInput
            id="fb-privacy-url"
            kind="url"
            label={t("form.consent.privacyUrl")}
            value={def.consent.privacyUrl ?? ""}
            placeholder="/policies/privacy-policy"
            details={t("form.consent.privacyUrlHelp")}
            error={errAt("fb-privacy-url")}
            onBlur={() => onTouch("fb-privacy-url")}
            onChange={(v) => edit((d) => (d.consent.privacyUrl = v.trim() ? v : null))}
          />
        </s-stack>
      </s-section>

      <s-section heading={t("form.success.heading")}>
        <s-stack direction="block" gap="base">
          <TextInput
            id="fb-success-text"
            label={t("form.success.message")}
            rows={3}
            value={def.success.texts[locale] ?? ""}
            placeholder={defaults[sfKey.success] ?? ""}
            details={t("form.success.messageHelp")}
            maxLength={LIMITS.success}
            error={errAt("fb-success-text")}
            onBlur={() => onTouch("fb-success-text")}
            onChange={(v) => edit((d) => setLocaleText(d.success.texts, locale, v))}
          />
          <TextInput
            id="fb-redirect-url"
            kind="url"
            label={t("form.success.redirect")}
            value={def.success.redirectUrl ?? ""}
            placeholder="/pages/thank-you"
            details={t("form.success.redirectHelp")}
            error={errAt("fb-redirect-url")}
            onBlur={() => onTouch("fb-redirect-url")}
            onChange={(v) => edit((d) => (d.success.redirectUrl = v.trim() ? v : null))}
          />
        </s-stack>
      </s-section>

      <s-section heading={t("form.spam.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("form.spam.body")}</s-paragraph>
          <CheckboxInput
            id="fb-spam-enabled"
            label={t("form.spam.enable")}
            checked={def.spamQuestion.enabled}
            onChange={(on) => edit((d) => (d.spamQuestion.enabled = on))}
          />
          {def.spamQuestion.enabled && (
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
              <TextInput
                id="fb-spam-question"
                label={t("form.spam.question")}
                value={spam.question}
                placeholder={t("form.spam.questionExample")}
                maxLength={LIMITS.spam}
                error={errAt("fb-spam-question")}
                onBlur={() => onTouch("fb-spam-question")}
                onChange={(v) => setSpam("question", v)}
              />
              <TextInput
                id="fb-spam-answer"
                label={t("form.spam.answer")}
                value={spam.answer}
                placeholder={t("form.spam.answerExample")}
                details={t("form.spam.answerHelp")}
                maxLength={LIMITS.spam}
                onBlur={() => onTouch("fb-spam-question")}
                onChange={(v) => setSpam("answer", v)}
              />
            </s-grid>
          )}
        </s-stack>
      </s-section>
    </>
  );
}
