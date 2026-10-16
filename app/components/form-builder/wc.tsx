/* eslint-disable @typescript-eslint/no-explicit-any -- web component properties are untyped DOM at this boundary */
import { useCallback, useEffect, useRef, type ReactNode } from "react";

// React 18 doesn't wire `onChange` to custom elements and writes booleans as
// the string "false". These wrappers set Polaris web component properties
// directly and listen to their native events, so state stays in React.

export function useWc(props: Record<string, unknown>, events: Record<string, ((e: Event) => void) | undefined>) {
  const el = useRef<HTMLElement | null>(null);
  const handlers = useRef(events);
  const detach = useRef<(() => void) | null>(null);
  const names = Object.keys(events).join(",");

  useEffect(() => {
    handlers.current = events;
  });

  // Callback ref: attach listeners when the element mounts, detach when it goes.
  const ref = useCallback(
    (node: HTMLElement | null) => {
      detach.current?.();
      detach.current = null;
      el.current = node;
      if (!node) return;
      const list = names.split(",").filter(Boolean).map((name) => {
        const h = (e: Event) => handlers.current[name]?.(e);
        node.addEventListener(name, h);
        return [name, h] as const;
      });
      detach.current = () => list.forEach(([name, h]) => node.removeEventListener(name, h));
    },
    [names],
  );

  useEffect(() => {
    const node = el.current as any;
    if (!node) return;
    for (const [k, v] of Object.entries(props)) if (node[k] !== v) node[k] = v;
  });
  return ref;
}

/** Spread only when true, so SSR markup carries the attribute without React writing "false". */
export const flag = (name: string, on: boolean | undefined) => (on ? { [name]: true } : {});

type TextProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  details?: string;
  placeholder?: string;
  kind?: "text" | "url" | "email" | "number";
  rows?: number;
  disabled?: boolean;
  maxLength?: number;
  labelHidden?: boolean;
};

export function TextInput(p: TextProps) {
  const ref = useWc(
    { value: p.value, disabled: Boolean(p.disabled), error: p.error ?? "" },
    { input: (e) => p.onChange(String((e.currentTarget as any).value ?? "")), blur: () => p.onBlur?.() },
  );
  const common = {
    ref,
    id: p.id,
    label: p.label,
    value: p.value,
    details: p.details,
    placeholder: p.placeholder,
    error: p.error || undefined,
    ...(p.labelHidden ? { labelAccessibilityVisibility: "exclusive" as const } : {}),
    ...flag("disabled", p.disabled),
  };
  if (p.rows) return <s-text-area {...common} rows={p.rows} maxLength={p.maxLength} />;
  if (p.kind === "url") return <s-url-field {...common} maxLength={p.maxLength} />;
  if (p.kind === "email") return <s-email-field {...common} maxLength={p.maxLength} />;
  if (p.kind === "number") return <s-number-field {...common} />;
  return <s-text-field {...common} maxLength={p.maxLength} />;
}

export function SelectInput(p: {
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  details?: string;
  error?: string;
  disabled?: boolean;
  labelHidden?: boolean;
}) {
  const ref = useWc(
    { value: p.value, disabled: Boolean(p.disabled), error: p.error ?? "" },
    { change: (e) => p.onChange(String((e.currentTarget as any).value ?? "")) },
  );
  return (
    <s-select
      ref={ref}
      id={p.id}
      label={p.label}
      value={p.value}
      details={p.details}
      error={p.error || undefined}
      {...(p.labelHidden ? { labelAccessibilityVisibility: "exclusive" as const } : {})}
      {...flag("disabled", p.disabled)}
    >
      {p.options.map((o) => (
        <s-option key={o.value} value={o.value} {...flag("disabled", o.disabled)}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}

export function CheckboxInput(p: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  details?: string;
  disabled?: boolean;
}) {
  const ref = useWc(
    { checked: p.checked, disabled: Boolean(p.disabled) },
    { change: (e) => p.onChange(Boolean((e.currentTarget as any).checked)) },
  );
  return (
    <s-checkbox
      ref={ref}
      id={p.id}
      label={p.label}
      details={p.details}
      {...flag("checked", p.checked)}
      {...flag("disabled", p.disabled)}
    />
  );
}

/** Single-choice radio group (s-choice-list). */
export function RadioGroup(p: {
  id?: string;
  label: string;
  value: string;
  choices: { value: string; label: string; details?: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  details?: string;
}) {
  const ref = useWc(
    { values: [p.value] },
    { change: (e) => p.onChange(String(((e.currentTarget as any).values ?? [])[0] ?? "")) },
  );
  return (
    <s-choice-list ref={ref} id={p.id} label={p.label} details={p.details} values={[p.value]}>
      {p.choices.map((c) => (
        <s-choice key={c.value} value={c.value} {...flag("selected", c.value === p.value)} {...flag("disabled", c.disabled)}>
          {c.label}
          {c.details && <s-text slot="details">{c.details}</s-text>}
        </s-choice>
      ))}
    </s-choice-list>
  );
}

/** s-modal opened/closed from React state via its showOverlay/hideOverlay methods. */
/** Callers pass the action buttons as children with slot="primary-action" / "secondary-actions". */
export function Modal(p: { id: string; heading: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useWc({}, { hide: () => p.onClose() });
  const node = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (n: HTMLElement | null) => {
      node.current = n;
      ref(n);
    },
    [ref],
  );
  useEffect(() => {
    const m = node.current as any;
    if (!m) return;
    if (p.open) m.showOverlay?.();
    else m.hideOverlay?.();
  }, [p.open]);
  return (
    <s-modal ref={setRef} id={p.id} heading={p.heading}>
      {p.children}
    </s-modal>
  );
}
