import { useCallback, useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

// Theme app extension status and theme editor deep links.
// Deep-link formats (shopify.dev, theme app extensions → configuration):
//   embed: /admin/themes/current/editor?context=apps&template=<t>&activateAppId=<api_key>/<handle>
//   block: /admin/themes/current/editor?template=<t>&addAppBlockId=<api_key>/<handle>&target=newAppsSection

export const EXTENSION_HANDLE = "tradepass-theme";
/** Fallback file handles if app.extensions() can't tell us (blocks/<handle>.liquid). */
export const FALLBACK_HANDLES = { embed: "tradepass-embed", formBlock: "wholesale-form" };

const id = (apiKey: string, handle: string) => `${encodeURIComponent(apiKey)}/${encodeURIComponent(handle)}`;

export function embedEditorUrl(shop: string, apiKey: string, handle: string, template = "index"): string {
  return `https://${shop}/admin/themes/current/editor?context=apps&template=${encodeURIComponent(template)}&activateAppId=${id(apiKey, handle)}`;
}

export function blockEditorUrl(shop: string, apiKey: string, handle: string, template = "page"): string {
  return `https://${shop}/admin/themes/current/editor?template=${encodeURIComponent(template)}&addAppBlockId=${id(apiKey, handle)}&target=newAppsSection`;
}

export type EmbedStatus = "loading" | "active" | "available" | "unavailable" | "unknown";

type Activation = { handle: string; target: string; status: string };
type ExtState = { status: EmbedStatus; embedHandle: string; formBlockHandle: string; formBlockPlaced: boolean };

async function readStatus(shopify: ReturnType<typeof useAppBridge>): Promise<ExtState> {
  try {
    const list = await shopify.app.extensions();
    const ext = list.find((e) => e.type === "theme_app_extension" && e.handle === EXTENSION_HANDLE) ?? list.find((e) => e.type === "theme_app_extension");
    const acts = (ext?.activations ?? []) as unknown as Activation[];
    const embed = acts.find((a) => a.target === "head" || a.target === "body");
    const block = acts.find((a) => a.target === "section" && /form/i.test(a.handle)) ?? acts.find((a) => a.target === "section");
    const status = embed?.status as EmbedStatus | undefined;
    return {
      status: status && ["active", "available", "unavailable"].includes(status) ? status : "unknown",
      embedHandle: embed?.handle ?? FALLBACK_HANDLES.embed,
      formBlockHandle: block?.handle ?? FALLBACK_HANDLES.formBlock,
      formBlockPlaced: block?.status === "active",
    };
  } catch {
    return { status: "unknown", embedHandle: FALLBACK_HANDLES.embed, formBlockHandle: FALLBACK_HANDLES.formBlock, formBlockPlaced: false };
  }
}

/**
 * Reads shopify.app.extensions() (published theme only). Status values are
 * lowercase. Shopify can report a stale status for a while after a change, so
 * the UI offers "Check again".
 */
export function useThemeExtension() {
  const shopify = useAppBridge();
  const [state, setState] = useState<ExtState>({
    status: "loading",
    embedHandle: FALLBACK_HANDLES.embed,
    formBlockHandle: FALLBACK_HANDLES.formBlock,
    formBlockPlaced: false,
  });

  const check = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    return readStatus(shopify).then(setState);
  }, [shopify]);

  useEffect(() => {
    let live = true;
    readStatus(shopify).then((next) => live && setState(next));
    return () => {
      live = false;
    };
  }, [shopify]);

  return { ...state, check };
}
