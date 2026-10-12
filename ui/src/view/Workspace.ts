import { Diagram, Palette, TypeSystem, type Library } from "core";
import { html, nothing } from "lit";
import { SignalElement } from "./elements/SignalElement.js";
import { DiagramEditor } from "./diagram/diagramEditor.js";
import type { DiagramRunController } from "./run/diagramRunController.js";
import { BrowserDiagramRunner } from "./run/browserDiagramRunner.js";
import { ScopeCaptureBoard } from "./scope/scopeCapture.js";
import { PaletteColumn } from "./palette/paletteColumnWidth.js";
import "./palette/PalettePanel.js";
import "./diagram/DiagramCanvas.js";
import "./toolbar/WorkspaceToolbar.js";

interface SplitPanelElement extends HTMLElement {
  position: number;
  primary?: "start" | "end";
}

export class Workspace extends SignalElement {
  static override properties = { libraries: { attribute: false } };
  declare libraries: readonly Library[] | undefined;
  private editor: DiagramEditor | undefined;
  private runner: DiagramRunController | undefined;
  private readonly board = new ScopeCaptureBoard();

  protected override willUpdate(): void {
    if (this.editor || !this.libraries) return;
    const diagram = new Diagram("diagram", "Diagram", combinedPalette(this.libraries));
    const runner = BrowserDiagramRunner.create(diagram, this.libraries, this.board);
    this.runner = runner;
    this.editor = new DiagramEditor(diagram, undefined, () => {
      if (runner.phase() !== "idle") void runner.stop();
    });
    this.editor.start();
  }

  override disconnectedCallback(): void {
    this.editor?.destroy();
    void this.runner?.stop();
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    const panel = this.querySelector<SplitPanelElement>("wa-split-panel");
    if (!panel) return;
    panel.position = 23;
    panel.primary = "start";
    requestAnimationFrame(() => new PaletteColumn(panel).fit());
  }

  protected override render() {
    if (!this.editor || !this.runner || !this.libraries) return nothing;
    return html`
      <div class="workspace-shell" @keydown=${(event: KeyboardEvent) => this.editor?.keyDown(event)}>
        <bld-workspace-toolbar .runner=${this.runner} .editor=${this.editor}></bld-workspace-toolbar>
        <wa-split-panel class="workspace">
          <bld-palette-panel slot="start" .libraries=${this.libraries} .editor=${this.editor}></bld-palette-panel>
          <bld-diagram-canvas slot="end" .editor=${this.editor} .board=${this.board} .runner=${this.runner}></bld-diagram-canvas>
        </wa-split-panel>
      </div>`;
  }
}

function combinedPalette(libraries: readonly Library[]): Palette {
  const first = libraries[0];
  if (!first) return new Palette(new TypeSystem());
  if (libraries.length === 1) return first.palette;
  const palette = new Palette(first.typeSystem);
  for (const library of libraries) {
    for (const block of library.palette.getBlocks()) palette.registerBlock(block);
  }
  return palette;
}
customElements.define("bld-workspace", Workspace);
