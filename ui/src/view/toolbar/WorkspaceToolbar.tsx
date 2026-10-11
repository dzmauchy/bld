import { DiagramRunController } from "../run/diagramRunController.js";
import type { DiagramEditor } from "../diagram/diagramEditor.js";

/** Page toolbar. Run becomes Stop once the diagram is running. */
export function WorkspaceToolbar(props: { runner: DiagramRunController; editor: DiagramEditor }) {
  const running = () => props.runner.phase() === "running" || props.runner.phase() === "stopping";
  const disabled = () => props.runner.phase() === "starting" || props.runner.phase() === "stopping";
  return (
    <header class="workspace-toolbar" data-toolbar>
      <button
        type="button"
        class="toolbar-run"
        data-run-toggle
        data-run-state={props.runner.phase()}
        disabled={disabled()}
        aria-pressed={running() ? "true" : "false"}
        onClick={() => {
          void props.runner.toggle();
        }}
      >
        {running() ? "Stop" : "Run"}
      </button>
      <button
        type="button"
        class="toolbar-delete"
        data-delete-selected
        disabled={props.editor.selection().size === 0}
        title="Delete selected blocks and connections (Delete / Backspace)"
        onClick={() => props.editor.deleteSelected()}
      >
        Delete
      </button>
      <p class="toolbar-status" data-run-status>
        {props.runner.status()}
      </p>
    </header>
  );
}
