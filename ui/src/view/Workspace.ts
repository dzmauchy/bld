import { Diagram, Palette, TypeSystem, type Library } from "core";
import { html, nothing } from "lit";
import { signal } from "@lit-labs/signals";
import { SignalElement } from "./elements/SignalElement.js";
import { DiagramEditor } from "./diagram/diagramEditor.js";
import type { DiagramRunController } from "./run/diagramRunController.js";
import { BrowserDiagramRunner } from "./run/browserDiagramRunner.js";
import { ScopeCaptureBoard } from "./scope/scopeCapture.js";
import { PaletteContentWidth } from "./palette/paletteColumnWidth.js";
import "./palette/PalettePanel.js";
import "./diagram/DiagramCanvas.js";
import "./toolbar/WorkspaceToolbar.js";

export class Workspace extends SignalElement {
  static override properties = { libraries: { attribute: false } };
  declare libraries: readonly Library[] | undefined;
  private editor: DiagramEditor | undefined;
  private runner: DiagramRunController | undefined;
  private readonly board = new ScopeCaptureBoard();
  private readonly paletteOpen = signal(false);

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

  protected override updated(): void {
    if (!this.paletteOpen.get()) return;
    const palette = this.querySelector<HTMLElement>("[data-region=palette]");
    if (palette) this.style.setProperty("--palette-width", `${new PaletteContentWidth(palette).column().pixels()}px`);
  }

  protected override render() {
    if (!this.editor || !this.runner || !this.libraries) return nothing;
    return html`
      <div class="workspace-shell" @keydown=${(event: KeyboardEvent) => this.editor?.keyDown(event)}>
        <bld-workspace-toolbar .runner=${this.runner} .editor=${this.editor} .paletteOpen=${this.paletteOpen.get()}
          .onTogglePalette=${() => this.paletteOpen.set(!this.paletteOpen.get())}></bld-workspace-toolbar>
        <div class="workspace-content">
          <bld-diagram-canvas .editor=${this.editor} .board=${this.board} .runner=${this.runner}></bld-diagram-canvas>
          <bld-palette-panel id="workspace-palette" ?hidden=${!this.paletteOpen.get()}
            .libraries=${this.libraries} .editor=${this.editor}></bld-palette-panel>
        </div>
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
