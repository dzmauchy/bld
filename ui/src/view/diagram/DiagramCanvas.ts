import { html, nothing, svg } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramEditor } from "./diagramEditor.js";
import type { DiagramRunController } from "../run/diagramRunController.js";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import "./DiagramBlockView.js";
import "./BlockConfigDialog.js";
import "../scope/ScopePlot.js";
import { DiagramGrid } from "./geometry.js";

export class DiagramCanvas extends SignalElement {
  static override properties = { editor: { attribute: false }, board: { attribute: false }, runner: { attribute: false } };
  declare editor: DiagramEditor | undefined;
  declare board: ScopeCaptureBoard | undefined;
  declare runner: DiagramRunController | undefined;

  protected override updated(): void {
    this.editor?.attachCanvas(this.querySelector<HTMLElement>("[data-diagram-canvas]") ?? undefined);
  }

  override disconnectedCallback(): void {
    this.editor?.attachCanvas(undefined);
    super.disconnectedCallback();
  }

  protected override render() {
    const { editor, board, runner } = this;
    if (!editor || !board || !runner) return nothing;
    let width = 0;
    let height = 0;
    for (const block of editor.placed()) {
      width = Math.max(width, block.x + block.frame.width + 80);
      height = Math.max(height, block.y + block.frame.height + 80);
    }
    for (const route of editor.routes()) {
      for (const point of route.points) {
        width = Math.max(width, point.x + 32);
        height = Math.max(height, point.y + 32);
      }
    }
    const configuredId = editor.configuredId();
    const configured = configuredId ? editor.model.getBlock(configuredId) : undefined;
    const inspectedId = editor.inspectedId();
    return html`<section class="region region-diagram" data-region="diagram">
      <div class=${`diagram-canvas${editor.armedId() ? " is-armed" : ""}`} data-diagram-canvas tabindex="0"
        style=${styleMap({ "--diagram-grid-spacing": `${DiagramGrid.spacing}px` })}
        aria-label="Diagram canvas" data-armed=${editor.armedId() ?? ""} @pointerdown=${(event: PointerEvent) => editor.canvasPointerDown(event)}>
        <div class="diagram-extent" style=${styleMap({ width: `${width}px`, height: `${height}px` })}></div>
        <svg class="diagram-wires" data-diagram-wires>
          <defs><marker id="diagram-wire-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z"></path>
          </marker></defs>
          ${repeat(editor.routes(), (route) => route.connectionId, (route) => svg`
            <g data-wire-id=${route.connectionId}>
              <polyline class="diagram-wire-hit" points=${route.pointsAttribute}></polyline>
              <polyline class=${`diagram-wire${editor.selection().hasConnection(route.connectionId) ? " is-selected" : ""}`}
                data-connection=${route.connectionId} data-selected=${String(editor.selection().hasConnection(route.connectionId))}
                data-route-origin=${route.origin} points=${route.pointsAttribute} marker-end="url(#diagram-wire-arrow)"></polyline>
            </g>`)}
        </svg>
        ${repeat(editor.placed(), (block) => block.id, (block) => html`
          <bld-diagram-block .editor=${editor} .block=${block}></bld-diagram-block>`)}
      </div>
      ${configured ? html`<bld-block-config-dialog .block=${configured} .revision=${editor.configRevision()}
        .onCommit=${() => {
          editor.noteConfiguration();
          if (runner.phase() === "running") void runner.stop();
        }} .onClose=${() => editor.closeConfiguration()}></bld-block-config-dialog>` : nothing}
      ${inspectedId ? html`<bld-scope-plot .editor=${editor} .blockId=${inspectedId} .board=${board} .runner=${runner}
        .onClose=${() => editor.closeInspection()}></bld-scope-plot>` : nothing}
    </section>`;
  }
}
customElements.define("bld-diagram-canvas", DiagramCanvas);
