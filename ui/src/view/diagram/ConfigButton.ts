import { html, nothing } from "lit";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramEditor } from "./diagramEditor.js";
import type { PlacedBlock } from "./diagramBlockFrame.js";
import { gearIcon } from "./GearIcon.js";

export class ConfigButton extends SignalElement {
  static override properties = { editor: { attribute: false }, block: { attribute: false } };
  declare editor: DiagramEditor | undefined;
  declare block: PlacedBlock | undefined;

  protected override render() {
    const { editor, block } = this;
    if (!editor || !block?.configurable) return nothing;
    return html`<button type="button" class="diagram-block-config" data-block-config=${block.id}
      title="Configure" aria-label=${`Configure ${block.title}`}
      @pointerdown=${(event: PointerEvent) => { event.preventDefault(); event.stopPropagation(); }}
      @click=${(event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        editor.openConfiguration(block.id);
      }}>${gearIcon()}</button>`;
  }
}
customElements.define("bld-config-button", ConfigButton);
