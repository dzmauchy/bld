import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { DiagramBlock } from "core";
import { SignalElement } from "../elements/SignalElement.js";
import { GpioInputBlock } from "../run/gpioInputBlock.js";
import type { DiagramRunController } from "../run/diagramRunController.js";

/** Live inputs are deliberately separate from the block's saved configuration. */
export class GpioControls extends SignalElement {
  static override properties = { block: { attribute: false }, runner: { attribute: false }, revision: { attribute: false } };
  declare block: DiagramBlock | undefined;
  declare runner: DiagramRunController | undefined;
  declare revision: number;

  protected override render() {
    const { block, runner } = this;
    if (!block || !runner) return nothing;
    const gpio = GpioInputBlock.of(block);
    if (!gpio) return nothing;
    return html`<div class="gpio-controls" @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
      @click=${(event: MouseEvent) => event.stopPropagation()}>
      ${repeat(gpio.pins, (_pin, index) => index, (pin, index) => {
        const on = runner.gpioValue(block.id, index);
        return html`<button type="button" class="gpio-switch" role="switch" data-gpio-pin=${index}
          aria-label=${`GPIO pin ${pin}`} aria-checked=${String(on)} ?disabled=${runner.phase() !== "running"}
          @click=${() => void runner.setGpio(block.id, index, !runner.gpioValue(block.id, index))}>
          <span>${pin}</span><span class="gpio-switch-track" aria-hidden="true"></span><span>${on ? "On" : "Off"}</span>
        </button>`;
      })}
    </div>`;
  }
}
customElements.define("bld-gpio-controls", GpioControls);
