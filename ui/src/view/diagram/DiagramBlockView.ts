import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { SignalElement } from "../elements/SignalElement.js";
import { BlockAccent } from "../palette/palettePresenter.js";
import { BlockGlyphCatalog } from "../palette/blockGlyphs.js";
import type { DiagramEditor } from "./diagramEditor.js";
import type { PlacedBlock } from "./diagramBlockFrame.js";
import "./PortButton.js";
import "./ConfigButton.js";

export class DiagramBlockView extends SignalElement {
  static override properties = { editor: { attribute: false }, block: { attribute: false } };
  declare editor: DiagramEditor | undefined;
  declare block: PlacedBlock | undefined;

  protected override render() {
    const { editor, block } = this;
    if (!editor || !block) return nothing;
    const selected = editor.selection().hasBlock(block.id);
    return html`<article
      class=${`diagram-block ${BlockAccent.forCategory(block.category).className}${editor.movingId() === block.id ? " is-moving" : ""}${selected ? " is-selected" : ""}`}
      data-diagram-block=${block.id} data-block-ref=${block.ref} data-selected=${String(selected)}
      data-inspected=${String(editor.inspectedId() === block.id)}
      style=${styleMap({ left: `${block.x}px`, top: `${block.y}px`, width: `${block.frame.width}px`, height: `${block.frame.height}px` })}>
      <div class="diagram-block-body">
        <span class="diagram-block-icon" aria-hidden="true">${unsafeHTML(BlockGlyphCatalog.shared.markup(block.icon))}</span>
        <span class="diagram-block-title">${block.title}</span>
      </div>
      ${block.configurable ? html`<bld-config-button .editor=${editor} .block=${block}></bld-config-button>` : nothing}
      ${repeat(block.frame.ports, (port) => `${port.side}:${port.id}`, (port) => html`
        <bld-port-button .editor=${editor} .block=${block} .port=${port}></bld-port-button>`)}
    </article>`;
  }
}
customElements.define("bld-diagram-block", DiagramBlockView);
