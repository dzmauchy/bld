import type { BlockDefinition, PortDefinition } from "core";
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramEditor } from "../diagram/diagramEditor.js";
import { BlockGlyphCatalog } from "./blockGlyphs.js";
import { BlockAccent } from "./palettePresenter.js";

/** Selects a palette definition for insertion with the next canvas click. */
export class PaletteButton extends SignalElement {
  static override properties = {
    definition: { attribute: false }, editor: { attribute: false }, libraryId: { attribute: false },
  };
  declare definition: BlockDefinition | undefined;
  declare editor: DiagramEditor | undefined;
  declare libraryId: string;

  protected override render() {
    const block = this.definition;
    const editor = this.editor;
    if (!block || !editor) return nothing;
    const armed = editor.armedId() === block.id;
    return html`
      <button type="button" class=${`palette-item flow-node ${BlockAccent.forCategory(block.category).className}${armed ? " is-armed" : ""}`}
        data-block-id=${block.id} data-library=${this.libraryId} data-armed=${String(armed)} aria-pressed=${String(armed)}
        title=${block.description || block.title} @click=${() => editor.armDefinition(block)}>
        <div class="flow-node-port-col is-in">${[...block.inputs.values()].map((port) => portMark(port, "in"))}</div>
        <div class="flow-node-body">
          <span class="flow-node-icon" aria-hidden="true">${unsafeHTML(BlockGlyphCatalog.shared.markup(block.icon))}</span>
          <span class="flow-node-title">${block.title}</span>
        </div>
        <div class="flow-node-port-col is-out">${[...block.outputs.values()].map((port) => portMark(port, "out"))}</div>
      </button>`;
  }
}

function portMark(port: PortDefinition, side: "in" | "out") {
  const pin = html`<span class="block-port-anchor"><span class="block-port" title=${port.id}></span></span>`;
  if (!port.vector) return html`<div class=${`block-port-row is-${side}`}>${pin}</div>`;
  return html`<div class=${`block-port-vector is-${side}`}>
    <div class="block-port-vector-pins"><div class=${`block-port-row is-${side} is-vector`}>${pin}</div></div>
    <span class="block-port-vector-rail" aria-hidden="true"></span>
  </div>`;
}
customElements.define("bld-palette-button", PaletteButton);
