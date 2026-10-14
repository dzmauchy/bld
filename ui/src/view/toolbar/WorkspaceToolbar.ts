import { html, nothing, svg } from "lit";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import type WaDropdownItem from "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramRunController } from "../run/diagramRunController.js";

/** Page toolbar. Run becomes Stop once the diagram is running. */
export class WorkspaceToolbar extends SignalElement {
  static override properties = {
    runner: { attribute: false },
    paletteOpen: { type: Boolean }, onTogglePalette: { attribute: false },
    scopeEffects: { type: Boolean }, onToggleScopeEffects: { attribute: false },
  };
  declare runner: DiagramRunController | undefined;
  declare paletteOpen: boolean;
  declare onTogglePalette: (() => void) | undefined;
  declare scopeEffects: boolean;
  declare onToggleScopeEffects: (() => void) | undefined;

  constructor() {
    super();
    this.scopeEffects = true;
  }

  protected override render() {
    if (!this.runner) return nothing;
    const runner = this.runner;
    const phase = runner.phase();
    const running = phase === "running" || phase === "stopping";
    return html`
      <header class="workspace-toolbar" data-toolbar role="toolbar" aria-label="Diagram tools">
        <wa-dropdown class="toolbar-menu" data-workspace-menu placement="bottom-start"
          @wa-select=${(event: CustomEvent<{ item: WaDropdownItem }>) => {
            if (event.detail.item.value === "run") void runner.toggle();
            else if (event.detail.item.value === "scope-effects") this.onToggleScopeEffects?.();
          }}>
          <button slot="trigger" type="button" class="toolbar-button" data-menu-toggle title="Menu" aria-label="Menu">
            ${svg`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`}
          </button>
          <wa-dropdown-item value="run" data-menu-run ?disabled=${phase === "starting" || phase === "stopping"}>
            ${running ? "Stop" : "Run"}
          </wa-dropdown-item>
          <wa-dropdown-item value="scope-effects" type="checkbox" data-menu-scope-effects .checked=${this.scopeEffects}>
            Vintage oscilloscope effects
          </wa-dropdown-item>
        </wa-dropdown>
        <button type="button" class="toolbar-button toolbar-palette" data-palette-toggle title="Palette" aria-label="Palette"
          aria-expanded=${String(Boolean(this.paletteOpen))} aria-controls="workspace-palette"
          @click=${() => this.onTogglePalette?.()}>
          ${svg`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`}
        </button>
        <button type="button" class="toolbar-button toolbar-run" data-run-toggle data-run-state=${phase}
          title=${running ? "Stop" : "Run"} aria-label=${running ? "Stop" : "Run"}
          ?disabled=${phase === "starting" || phase === "stopping"} aria-pressed=${String(running)}
          @click=${() => void runner.toggle()}>
          ${running
            ? svg`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>`
            : svg`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8Z"/></svg>`}
        </button>
        ${runner.status() ? html`<span class="toolbar-status" title=${runner.status()} aria-label=${runner.status()}>
          ${svg`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v1"/></svg>`}
        </span>` : nothing}
      </header>
      <span class="toolbar-announcement" data-run-status role="status" aria-live="polite">${runner.status()}</span>`;
  }
}
customElements.define("bld-workspace-toolbar", WorkspaceToolbar);
