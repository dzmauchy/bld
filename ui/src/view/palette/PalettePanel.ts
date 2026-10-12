import type { Library } from "core";
import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { signal } from "@lit-labs/signals";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramEditor } from "../diagram/diagramEditor.js";
import { LibraryListPalettePresenter, PaletteExpansion, type PaletteGroup } from "./palettePresenter.js";
import "./PaletteButton.js";

export class PalettePanel extends SignalElement {
  static override properties = { libraries: { attribute: false }, editor: { attribute: false } };
  declare libraries: readonly Library[] | undefined;
  declare editor: DiagramEditor | undefined;
  private groups: readonly PaletteGroup[] = [];
  private readonly expansion = signal(PaletteExpansion.expanded([]));
  private presentedLibraries: readonly Library[] | undefined;

  protected override willUpdate(): void {
    if (!this.libraries || this.presentedLibraries === this.libraries) return;
    this.presentedLibraries = this.libraries;
    this.groups = new LibraryListPalettePresenter(this.libraries).present();
    this.expansion.set(PaletteExpansion.expanded(this.groups));
  }

  protected override render() {
    if (!this.libraries || !this.editor) return nothing;
    return html`<section class="region region-palette" data-region="palette"
      data-libraries=${this.libraries.map((library) => library.id).join(" ")} aria-label="Palette">
      <div class="palette-list">${this.groups.map((group) => this.folder(group, 0))}</div>
    </section>`;
  }

  private folder(group: PaletteGroup, depth: number): unknown {
    const open = this.expansion.get().has(group.id);
    return html`<div class=${`palette-ns${depth > 0 ? " is-child" : ""}`} data-namespace=${group.id}>
      <button class=${`palette-ns-toggle${open ? " open" : ""}`} type="button"
        style=${styleMap({ "--palette-depth": String(depth) })} aria-expanded=${String(open)} title=${group.hint}
        @click=${() => this.expansion.set(this.expansion.get().toggled(group.id))}>
        <span class="palette-ns-label">${group.label}</span>
      </button>
      ${open ? html`<div class=${`palette-ns-body${depth > 0 ? " is-nested" : ""}`}>
        ${group.blocks.length ? html`<div class="palette-blocks-grid">
          ${repeat(group.blocks, (block) => block.id, (block) => html`<bld-palette-button
            .definition=${block} .editor=${this.editor} .libraryId=${group.libraryId}></bld-palette-button>`)}
        </div>` : nothing}
        ${group.children.map((child) => this.folder(child, depth + 1))}
      </div>` : nothing}
    </div>`;
  }
}
customElements.define("bld-palette-panel", PalettePanel);
