// @shopify/app-bridge-types declares its elements on the global JSX namespace,
// which React 19's types no longer read. Re-declare the one we use on React.JSX.
import type { HTMLAttributes, ReactNode } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": HTMLAttributes<HTMLElement> & { children?: ReactNode };
    }
  }
}
