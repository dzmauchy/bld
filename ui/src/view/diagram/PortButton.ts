import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramEditor } from "./diagramEditor.js";
import type { FramePort, PlacedBlock } from "./diagramBlockFrame.js";
import { PortHit } from "./diagramConnector.js";

/** Accessible port control for selecting an output followed by an input. */
export class PortButton extends SignalElement {
  static override properties = { editor: { attribute: false }, block: { attribute: false }, port: { attribute: false } };
  declare editor: DiagramEditor | undefined;
  declare block: PlacedBlock | undefined;
  declare port: FramePort | undefined;

  protected override render() {
    const { editor, block, port } = this;
    if (!editor || !block || !port) return nothing;
    const selected = editor.isPortSelected(block.id, port.id, port.side);
    return html`<button type="button"
      class=${`diagram-port is-${port.side}${port.vector ? " is-vector" : ""}${selected ? " is-selected" : ""}`}
      data-port-id=${port.id} data-port-side=${port.side} data-port-lanes=${port.lanes}
      data-selected=${String(selected)} aria-pressed=${String(selected)} aria-label=${`${block.title} ${port.side} ${port.id}`}
      title=${port.id} style=${styleMap({ left: `${port.x}px`, top: `${port.y}px`, height: port.vector ? `${port.span}px` : undefined })}
      @click=${(event: MouseEvent) => {
        event.stopPropagation();
        editor.selectPort(new PortHit(block.id, port.id, port.side));
      }}>
      ${port.vector ? html`<span class="diagram-port-rail"></span>${port.pins().map((pin) => html`
        <span class="diagram-port-pin" data-port-pin data-vector-index=${pin.index} style=${styleMap({ top: `${pin.top}px` })}></span>`)}
        ` : nothing}
    </button>`;
  }
}
customElements.define("bld-port-button", PortButton);
