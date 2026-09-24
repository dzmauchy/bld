import type { JSX } from "@solidjs/web";

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "wa-split-panel": JSX.HTMLAttributes<HTMLElement> & {
        ref?: (element: HTMLElement) => void;
      };
      "wa-animation": JSX.HTMLAttributes<HTMLElement> & {
        name?: string;
        play?: boolean;
        duration?: number | string;
        easing?: string;
        iterations?: number | string;
      };
      "wa-card": JSX.HTMLAttributes<HTMLElement> & { appearance?: string };
      "wa-spinner": JSX.HTMLAttributes<HTMLElement>;
      "wa-progress-bar": JSX.HTMLAttributes<HTMLElement> & {
        indeterminate?: boolean;
        label?: string;
        value?: number;
      };
    }
  }
}
