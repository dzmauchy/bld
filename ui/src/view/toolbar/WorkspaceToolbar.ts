import { html, nothing } from "lit";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramRunController } from "../run/diagramRunController.js";
import type { DiagramEditor } from "../diagram/diagramEditor.js";

/** Page toolbar. Run becomes Stop once the diagram is running. */
export class WorkspaceToolbar extends SignalElement {
  static override properties = { runner: { attribute: false }, editor: { attribute: false } };
  declare runner: DiagramRunController | undefined;
  declare editor: DiagramEditor | undefined;

  protected override render() {
    if (!this.runner || !this.editor) return nothing;
    const runner = this.runner;
    const editor = this.editor;
    const phase = runner.phase();
    const running = phase === "running" || phase === "stopping";
    return html`
      <header class="workspace-toolbar" data-toolbar>
        <button type="button" class="toolbar-run" data-run-toggle data-run-state=${phase}
          ?disabled=${phase === "starting" || phase === "stopping"} aria-pressed=${String(running)}
          @click=${() => void runner.toggle()}>${running ? "Stop" : "Run"}</button>
        <button type="button" class="toolbar-delete" data-delete-selected ?disabled=${editor.selection().size === 0}
          title="Delete selected blocks and connections (Delete / Backspace)" @click=${() => editor.deleteSelected()}>Delete</button>
        <p class="toolbar-status" data-run-status>${runner.status()}</p>
      </header>`;
  }
}
customElements.define("bld-workspace-toolbar", WorkspaceToolbar);
