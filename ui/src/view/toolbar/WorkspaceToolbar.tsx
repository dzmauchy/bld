import { DiagramRunController } from "../run/diagramRunController.js";

/** Page toolbar. Run becomes Stop once the diagram is running. */
export function WorkspaceToolbar(props: { runner: DiagramRunController }) {
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
      <p class="toolbar-status" data-run-status>
        {props.runner.status()}
      </p>
    </header>
  );
}
