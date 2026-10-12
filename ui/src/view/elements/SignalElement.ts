import { LitElement } from "lit";
import { SignalWatcher } from "@lit-labs/signals";

/** Signal-aware element sharing the workspace's global theme and light DOM. */
export abstract class SignalElement extends SignalWatcher(LitElement) {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}
