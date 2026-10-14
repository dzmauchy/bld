import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import type { DiagramBlock } from "core";
import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import { SignalElement } from "../elements/SignalElement.js";
import { BlockConfiguration, NumberConfigControl, type BlockConfigField } from "./blockConfiguration.js";

/** Dialog that edits every configuration parameter of one block. */
export class BlockConfigDialog extends SignalElement {
  static override properties = {
    block: { attribute: false }, revision: { attribute: false }, onCommit: { attribute: false }, onClose: { attribute: false },
    disabled: { type: Boolean },
  };
  declare block: DiagramBlock | undefined;
  declare revision: number;
  declare onCommit: (() => void) | undefined;
  declare onClose: (() => void) | undefined;
  declare disabled: boolean;

  protected override render() {
    if (!this.block) return nothing;
    return html`<wa-dialog class="block-config-dialog" data-block-config-dialog data-block-id=${this.block.id}
      label=${this.block.definition.title} .open=${true} .lightDismiss=${true}
      @wa-hide=${(event: Event) => { if (event.target === event.currentTarget) this.onClose?.(); }}>
      <form class="block-config-form" @submit=${(event: SubmitEvent) => event.preventDefault()}>
        ${repeat(BlockConfiguration.of(this.block)?.fields ?? [], (field) => field.id, (field) => this.field(field))}
      </form>
    </wa-dialog>`;
  }

  private field(field: BlockConfigField) {
    const control = field.control;
    const bounds = control instanceof NumberConfigControl ? control.bounds : undefined;
    const kind = control.kind;
    const commit = (event: Event) => {
      if (this.disabled) return;
      if (field.commit((event.currentTarget as HTMLInputElement).value)) this.onCommit?.();
    };
    return html`<label class="block-config-field" data-config-field=${field.id}>
      <span class="block-config-label">${field.label}</span>
      <input type=${kind === "slider" ? "range" : kind === "text" ? "text" : "number"}
        ?disabled=${this.disabled}
        min=${bounds?.min ?? nothing} max=${bounds?.max ?? nothing} step=${bounds?.step ?? (kind === "slider" ? nothing : "any")}
        .value=${live(field.text)} @input=${kind === "slider" ? commit : nothing} @change=${kind === "slider" ? nothing : commit}>
      <span class="block-config-hint">${field.description}</span>
    </label>`;
  }
}
customElements.define("bld-block-config-dialog", BlockConfigDialog);
