import type { JSX } from "@solidjs/web";

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "wa-split-panel": JSX.HTMLAttributes<HTMLElement> & {
        ref?: (element: HTMLElement) => void;
      };
    }
  }
}
