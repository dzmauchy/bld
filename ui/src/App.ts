import type { Library } from "core";
import { html } from "lit";
import { signal } from "@lit-labs/signals";
import { LibraryList } from "./libraries/libraryList.js";
import { SignalElement } from "./view/elements/SignalElement.js";
import "./view/Workspace.js";

export class App extends SignalElement {
  static override properties = { onShown: { attribute: false } };
  declare onShown: (() => void) | undefined;
  private readonly libraries = signal<readonly Library[] | undefined>(undefined);
  private readonly failure = signal<string | undefined>(undefined);
  private loading: Promise<void> | undefined;
  private shown = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.loading ??= new LibraryList().load().then((libraries) => {
      this.libraries.set(libraries);
    }).catch((error: unknown) => {
      this.failure.set(error instanceof Error ? error.message : String(error));
    });
  }

  protected override updated(): void {
    if (!this.shown && (this.libraries.get() || this.failure.get())) {
      this.shown = true;
      requestAnimationFrame(() => this.onShown?.());
    }
  }

  protected override render() {
    const libraries = this.libraries.get();
    const failure = this.failure.get();
    return libraries
      ? html`<bld-workspace .libraries=${libraries}></bld-workspace>`
      : html`<p data-library-status=${failure ? "error" : "loading"}>${failure ?? "Loading libraries"}</p>`;
  }
}
customElements.define("bld-app", App);
